import { describe, it, expect } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { parseAmount, formatAmount, hex, unhex } from "../sdk/bytes";
import { rootFromSecret, signOnce, verify } from "../sdk/winternitz";
import { encodeIntent, decodeIntent, message } from "../sdk/protocol";
import { encryptKit, decryptKit } from "../sdk/recovery";
import fixture from "../fixtures/winterwallet-n32.json";
describe("Exact amounts", () => {
  it("round-trips amounts above JS safe integer", () => {
    const n = parseAmount("123456789.123456789", 9);
    expect(n).toBe(123456789123456789n);
    expect(formatAmount(n, 9)).toBe("123456789.123456789");
  });
  it.each([
    "0",
    "-1",
    "1e9",
    "NaN",
    "1,000",
    "1.0000000001",
    "18446744073709551616",
  ])("rejects %s", (s) => {
    expect(() => parseAmount(s, 9)).toThrow();
  });
});
describe("Winterwallet N=32 interoperability", () => {
  it("matches upstream Rust commitment and signature", () => {
    const key = unhex(fixture.secret),
      msg = unhex(fixture.message);
    expect(hex(rootFromSecret(key))).toBe(fixture.root);
    expect(hex(signOnce(key, msg))).toBe(fixture.signature);
    expect(key.every((b) => b === 0)).toBe(true);
    expect(verify(unhex(fixture.signature), msg, unhex(fixture.root))).toBe(
      true,
    );
  });
  it("rejects changed message, signature and root", () => {
    const msg = unhex(fixture.message);
    msg[0] ^= 1;
    expect(verify(unhex(fixture.signature), msg, unhex(fixture.root))).toBe(
      false,
    );
    const sig = unhex(fixture.signature);
    sig[0] ^= 1;
    expect(verify(sig, unhex(fixture.message), unhex(fixture.root))).toBe(
      false,
    );
    expect(
      verify(
        unhex(fixture.signature),
        unhex(fixture.message),
        new Uint8Array(32),
      ),
    ).toBe(false);
  });
});
describe("Canonical withdrawal", () => {
  it("binds each field including program and vault", () => {
    const p = new PublicKey(new Uint8Array(32).fill(1)),
      v = new PublicKey(new Uint8Array(32).fill(2));
    const i = {
      nonce: 1n,
      kind: 0 as const,
      mint: PublicKey.default,
      destination: p,
      amount: 100n,
      nextRoot: new Uint8Array(32).fill(3),
    };
    const wire = encodeIntent(i);
    expect(wire.length).toBe(113);
    expect(decodeIntent(wire)).toEqual(i);
    expect(hex(message(p, v, wire))).not.toBe(hex(message(v, p, wire)));
    for (const patch of [
      { nonce: 2n },
      { amount: 101n },
      { destination: v },
      { nextRoot: new Uint8Array(32).fill(4) },
      { kind: 1 as const },
      { mint: v },
    ])
      expect(hex(encodeIntent({ ...i, ...patch }))).not.toBe(hex(wire));
  });
});
describe("Encrypted recovery", () => {
  it("round-trips and rejects wrong password or tampering", async () => {
    const kit = {
      version: 1 as const,
      network: "devnet" as const,
      genesis: "test",
      program: "test",
      vaultId: "01".repeat(32),
      vault: "test",
      nonce: "0",
      root: fixture.root,
      secret: fixture.secret,
    };
    const encrypted = await encryptKit(kit, "correct horse battery staple");
    expect(encrypted).not.toContain(fixture.secret);
    expect(await decryptKit(encrypted, "correct horse battery staple")).toEqual(
      kit,
    );
    await expect(
      decryptKit(encrypted, "incorrect password!"),
    ).rejects.toThrow();
    const altered = JSON.parse(encrypted);
    altered.iv = "00".repeat(12);
    await expect(
      decryptKit(JSON.stringify(altered), "correct horse battery staple"),
    ).rejects.toThrow();
  });
});
