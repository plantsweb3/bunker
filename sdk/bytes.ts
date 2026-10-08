export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}
export function hex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
export function unhex(s: string, length?: number): Uint8Array {
  if (
    !/^(?:[a-f0-9]{2})+$/i.test(s) ||
    (length !== undefined && s.length !== length * 2)
  )
    throw new Error("Invalid byte encoding");
  return Uint8Array.from(s.match(/../g)!, (x) => parseInt(x, 16));
}
export function u64(n: bigint): Uint8Array {
  if (n < 0n || n > 0xffffffffffffffffn)
    throw new Error("Amount exceeds unsigned 64-bit range");
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, true);
  return b;
}
export function readU64(b: Uint8Array, offset = 0): bigint {
  return new DataView(b.buffer, b.byteOffset, b.byteLength).getBigUint64(
    offset,
    true,
  );
}
export function equal(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
export function parseAmount(s: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18)
    throw new Error("Unsupported asset precision");
  // Accept what people and phone keyboards actually type: surrounding spaces,
  // a leading or trailing point, and a single comma as the decimal mark.
  // Anything that could be read two ways (thousands separators, exponents,
  // signs) is refused rather than guessed.
  const typed = s.trim();
  // "1,000" is a thousand to some people and one to others. Never guess.
  if (/^\d+,\d{3}$/.test(typed))
    throw new Error(`“${typed}” could mean two different amounts. Write it with a point, like 1000 or 1.000.`);
  const t = typed.replace(/^(\d*),(\d*)$/, "$1.$2");
  if (!/^(\d+\.?\d*|\.\d+)$/.test(t) || /^0\d/.test(t))
    throw new Error("Enter an amount like 1.5, with no thousands separators");
  const [whole = "0", fraction = ""] = t.split(".");
  if (fraction.length > decimals)
    throw new Error(`Use at most ${decimals} decimal places`);
  const n =
    BigInt(whole || "0") * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0") || "0");
  if (n <= 0n || n > 0xffffffffffffffffn)
    throw new Error("Amount is outside the supported range");
  return n;
}
export function formatAmount(n: bigint, decimals: number): string {
  const s = n.toString().padStart(decimals + 1, "0");
  if (!decimals) return s;
  return `${s.slice(0, -decimals)}.${s.slice(-decimals)}`.replace(/\.?0+$/, "");
}
