import { describe, it, expect } from "vitest";
import { parseAmount, formatAmount } from "../sdk/bytes";
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
