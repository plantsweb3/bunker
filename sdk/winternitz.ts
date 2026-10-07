/** Browser port of Winterwallet core N=32. MIT, Dean Little.
 * Upstream: 672fc6789b1532ee680f24842d235e0be8737b61.
 * Same SHA-256 chains, checksum, and tagged Merkle commitment.
 * Raw independent CSPRNG scalars; upstream mnemonic derivation is NOT used.
 * Unreviewed integration. This is NOT WOTS+ or a NIST-approved parameter set.
 */
import { sha256 } from "@noble/hashes/sha256";
import { concat, equal } from "./bytes";
export const SECRET_BYTES = 1088;
export function chain(input: Uint8Array, n: number): Uint8Array {
  let out: Uint8Array = input.slice();
  for (let i = 0; i < n; i++) out = sha256(out);
  return out;
}
export function merklize(scalars: Uint8Array[]): Uint8Array {
  let level = scalars.map((s) => sha256(concat(new Uint8Array([0]), s)));
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2)
      next.push(
        sha256(concat(new Uint8Array([1]), level[i], level[i + 1] ?? level[i])),
      );
    level = next;
  }
  return level[0];
}
function scalars(secret: Uint8Array) {
  if (secret.length !== SECRET_BYTES)
    throw new Error("Invalid one-time key length");
  return Array.from({ length: 34 }, (_, i) =>
    secret.slice(i * 32, (i + 1) * 32),
  );
}
function digits(message: Uint8Array): number[] {
  const d = Array.from(sha256(message));
  const checksum = d.reduce((s, v) => s + 255 - v, 0);
  return [...d, checksum >>> 8, checksum & 255];
}
export function generateKey(): { secret: Uint8Array; root: Uint8Array } {
  const secret = crypto.getRandomValues(new Uint8Array(SECRET_BYTES));
  return { secret, root: rootFromSecret(secret) };
}
export function rootFromSecret(secret: Uint8Array): Uint8Array {
  return merklize(scalars(secret).map((s) => chain(s, 255)));
}
/** Internal primitive. Application MUST reserve exact intent before calling. Consumes input. */
export function signOnce(secret: Uint8Array, message: Uint8Array): Uint8Array {
  try {
    const d = digits(message);
    return concat(...scalars(secret).map((s, i) => chain(s, d[i])));
  } finally {
    secret.fill(0);
  }
}
export function verify(
  signature: Uint8Array,
  message: Uint8Array,
  root: Uint8Array,
): boolean {
  if (signature.length !== SECRET_BYTES) return false;
  const d = digits(message);
  return equal(
    merklize(scalars(signature).map((s, i) => chain(s, 255 - d[i]))),
    root,
  );
}
