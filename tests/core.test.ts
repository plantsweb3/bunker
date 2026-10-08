import { describe, it, expect } from "vitest";
import { parseAmount, formatAmount, hex, unhex } from "../sdk/bytes";
import { rootFromSecret, signOnce, verify } from "../sdk/winternitz";
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
    "1,000,000",
    "1.2.3",
    "1,2,3",
    "-1",
    "+1",
    "01",
    ".",
    ",",
    "",
    " ",
    "1 000",
    "0x10",
  ])("rejects %s", (s) => {
    expect(() => parseAmount(s, 9)).toThrow();
  });
  it("accepts what people type, and refuses to guess at a comma that could mean thousands", () => {
    expect(parseAmount(".5", 9)).toBe(500_000_000n);
    expect(parseAmount("1.", 9)).toBe(1_000_000_000n);
    expect(parseAmount(" 1.5 ", 9)).toBe(1_500_000_000n);
    expect(parseAmount("1,5", 9)).toBe(1_500_000_000n);
    expect(parseAmount("0,25", 9)).toBe(250_000_000n);
    expect(() => parseAmount("0", 9)).toThrow("outside the supported range");
    expect(() => parseAmount("1,000", 9)).toThrow("two different amounts");
    expect(() => parseAmount("0,001", 9)).toThrow("two different amounts");
    expect(parseAmount("0.001", 9)).toBe(1_000_000n);
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
