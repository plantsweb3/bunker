import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { sha256 } from "@noble/hashes/sha256";
import { hex, unhex } from "../sdk/bytes";
import {
  decodeIntent,
  encodeIntent,
  message,
  spentAddress,
  vaultAddress,
} from "../sdk/protocol";
import { rootFromSecret, signOnce, verify } from "../sdk/winternitz";
import fixture from "../fixtures/bunker-v2.json";
import pinned from "../vendor/winterwallet-revision.json";
describe("Rust / TypeScript v2 protocol fixtures", () => {
  const program = new PublicKey(fixture.program),
    vault = new PublicKey(fixture.vault);
  it("reproduces fixed encoding, full signed bytes, digest, verification and two rotations", () => {
    expect(vaultAddress(program, unhex(fixture.vaultId))).toEqual(vault);
    for (const [index, v] of fixture.vectors.entries()) {
      const payload = unhex(v.payload),
        intent = decodeIntent(payload);
      expect(intent).toEqual({
        vaultId: unhex(fixture.vaultId),
        expirySlot: BigInt(fixture.expirySlot),
        nonce: BigInt(v.nonce),
        kind: 0,
        mint: PublicKey.default,
        destination: new PublicKey(fixture.destination),
        amount: 123456789n + BigInt(index),
        nextRoot: unhex(v.nextRoot),
      });
      expect(hex(encodeIntent(intent))).toBe(v.payload);
      const msg = message(program, vault, payload);
      expect(msg.length).toBe(238);
      expect(hex(msg)).toBe(v.message);
      expect(hex(sha256(msg))).toBe(v.digest);
      expect(hex(rootFromSecret(unhex(v.secret)))).toBe(v.root);
      expect(hex(signOnce(unhex(v.secret), msg))).toBe(v.signature);
      expect(verify(unhex(v.signature), msg, unhex(v.root))).toBe(true);
      expect(verify(unhex(v.signature), msg, unhex(v.nextRoot))).toBe(false);
      expect(spentAddress(program, unhex(v.root))).not.toEqual(
        spentAddress(program, unhex(v.nextRoot)),
      );
      if (index + 1 < fixture.vectors.length)
        expect(v.nextRoot).toBe(fixture.vectors[index + 1].root);
    }
  });
  it("binds domain, program, vault, version, id, nonce, kind, mint, destination, amount, expiry and next commitment", () => {
    const v = fixture.vectors[0];
    for (const offset of [
      0, 20, 52, 84, 85, 117, 125, 126, 158, 190, 198, 206,
    ]) {
      const msg = unhex(v.message);
      msg[offset] ^= 1;
      expect(
        verify(unhex(v.signature), msg, unhex(v.root)),
        `offset ${offset}`,
      ).toBe(false);
    }
  });
  it("rejects every truncation, trailing bytes, old version, invalid kind, zero fields and wrong vault context", () => {
    const payload = unhex(fixture.vectors[0].payload);
    for (let i = 0; i < payload.length; i++)
      expect(() => decodeIntent(payload.slice(0, i))).toThrow();
    expect(() => decodeIntent(new Uint8Array([...payload, 0]))).toThrow();
    for (const [offset, value] of [
      [0, 1],
      [41, 2],
      [42, 1],
    ]) {
      const bad = payload.slice();
      bad[offset] = value;
      expect(() => decodeIntent(bad)).toThrow();
    }
    for (const [start, end] of [
      [106, 114],
      [114, 122],
      [122, 154],
    ]) {
      const bad = payload.slice();
      bad.fill(0, start, end);
      expect(() => decodeIntent(bad)).toThrow();
    }
    expect(() => message(PublicKey.default, vault, payload)).toThrow();
    expect(() => message(program, PublicKey.default, payload)).toThrow();
  });
  it("pins every unchanged upstream algorithm file at the approved revision", () => {
    expect(pinned.revision).toBe("672fc6789b1532ee680f24842d235e0be8737b61");
    const actual = fs
      .readdirSync("crates/winterwallet-core/src", { recursive: true })
      .map(String)
      .map((p) => `crates/winterwallet-core/src/${p}`)
      .filter((p) => fs.statSync(p).isFile())
      .sort();
    expect(actual).toEqual(Object.keys(pinned.sha256).sort());
    for (const [path, expected] of Object.entries(pinned.sha256))
      expect(
        createHash("sha256").update(fs.readFileSync(path)).digest("hex"),
        path,
      ).toBe(expected);
  });
});
