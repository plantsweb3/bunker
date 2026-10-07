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
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(s))
    throw new Error(
      "Enter a positive amount without commas or exponent notation",
    );
  const [whole, fraction = ""] = s.split(".");
  if (fraction.length > decimals)
    throw new Error(`Use at most ${decimals} decimal places`);
  const n =
    BigInt(whole) * 10n ** BigInt(decimals) +
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
