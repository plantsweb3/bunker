/** LM-OTS one-time signatures as specified in RFC 8554, section 4, for the
 * single parameter set `LMOTS_SHA256_N32_W8`: SHA-256, 32-byte values, 8-bit
 * Winternitz digits, 34 chains, a 1,124-byte signature.
 *
 * Every hash input follows the RFC byte for byte; `tests/lmots.test.ts` checks
 * this file against the RFC's Appendix F. The program's verifier is
 * `crates/bunker-lmots`, written separately against the same text.
 *
 * Unreviewed. A key signs ONE message; a second, different message under the
 * same key lets anyone forge. Callers enforce that, not this file. */
import { sha256 } from "@noble/hashes/sha256";
import { concat, equal } from "./bytes";
const N = 32;
const P = 34;
/** `u32str(LMOTS_SHA256_N32_W8)`. */
const TYPECODE = new Uint8Array([0, 0, 0, 4]);
const D_PBLC = new Uint8Array([0x80, 0x80]);
const D_MESG = new Uint8Array([0x81, 0x81]);
/** The 34 secret chain starts `x[0..33]`, concatenated. */
export const SECRET_BYTES = N * P;
/** `u32str(type) || C || y[0] || ... || y[33]`. */
export const SIGNATURE_BYTES = 4 + N + N * P;
export const IDENTIFIER_BYTES = 16;
export const RANDOMIZER_BYTES = N;
/** The pair a key is bound to: `I` and `q` in the RFC. */
export type Signer = { identifier: Uint8Array; q: number };

function prefix(s: Signer): Uint8Array {
  if (s.identifier.length !== IDENTIFIER_BYTES) throw new Error("Invalid signer identifier");
  if (!Number.isInteger(s.q) || s.q < 0 || s.q > 0xffffffff) throw new Error("Invalid signer index");
  const out = new Uint8Array(IDENTIFIER_BYTES + 4);
  out.set(s.identifier);
  new DataView(out.buffer).setUint32(IDENTIFIER_BYTES, s.q, false);
  return out;
}
/** Applies steps `from..to-1` of chain `i` to `value`:
 * `tmp = H(I || u32str(q) || u16str(i) || u8str(j) || tmp)`. */
function chain(head: Uint8Array, i: number, from: number, to: number, value: Uint8Array) {
  const step = new Uint8Array(head.length + 3 + N);
  step.set(head);
  step[head.length] = i >>> 8;
  step[head.length + 1] = i & 255;
  step.set(value, head.length + 3);
  for (let j = from; j < to; j++) {
    step[head.length + 2] = j;
    step.set(sha256(step), head.length + 3);
  }
  return step.slice(head.length + 3);
}
/** `Q || Cksm(Q)` as 34 base-256 digits. */
function digits(head: Uint8Array, randomizer: Uint8Array, message: Uint8Array): number[] {
  const q = Array.from(sha256(concat(head, D_MESG, randomizer, message)));
  const sum = q.reduce((s, v) => s + 255 - v, 0);
  return [...q, sum >>> 8, sum & 255];
}
const cost = (d: number[]) => d.reduce((s, a) => s + 255 - a, 0);
const parts = (bytes: Uint8Array, expected: number, what: string) => {
  if (bytes.length !== expected) throw new Error(`Invalid ${what} length`);
  return Array.from({ length: P }, (_, i) => bytes.subarray(i * N, (i + 1) * N));
};

/** RFC 8554 Algorithm 1: the public key `K` of a secret. */
export function publicKey(s: Signer, secret: Uint8Array): Uint8Array {
  const head = prefix(s);
  const ends = parts(secret, SECRET_BYTES, "one-time key").map((x, i) => chain(head, i, 0, 255, x));
  return sha256(concat(head, D_PBLC, ...ends));
}
/** How many chain steps a verifier takes for this message and randomizer. */
export function verificationSteps(s: Signer, randomizer: Uint8Array, message: Uint8Array): number {
  if (randomizer.length !== RANDOMIZER_BYTES) throw new Error("Invalid randomizer length");
  return cost(digits(prefix(s), randomizer, message));
}
/** RFC 8554 Algorithm 3, with the randomizer `C` supplied by the caller. */
export function sign(
  s: Signer,
  secret: Uint8Array,
  randomizer: Uint8Array,
  message: Uint8Array,
): Uint8Array {
  if (randomizer.length !== RANDOMIZER_BYTES) throw new Error("Invalid randomizer length");
  const head = prefix(s);
  const d = digits(head, randomizer, message);
  const y = parts(secret, SECRET_BYTES, "one-time key").map((x, i) => chain(head, i, 0, d[i], x));
  return concat(TYPECODE, randomizer, ...y);
}
/** RFC 8554 Algorithm 4b: the candidate public key `Kc`, or `null` if the
 * signature is not well formed for this parameter set or would take more than
 * `stepLimit` chain steps to verify. */
export function candidateKey(
  s: Signer,
  message: Uint8Array,
  signature: Uint8Array,
  stepLimit = Infinity,
): Uint8Array | null {
  if (signature.length !== SIGNATURE_BYTES || !equal(signature.subarray(0, 4), TYPECODE)) return null;
  const head = prefix(s);
  const d = digits(head, signature.subarray(4, 4 + N), message);
  if (cost(d) > stepLimit) return null;
  const y = parts(signature.subarray(4 + N), SECRET_BYTES, "signature");
  return sha256(concat(head, D_PBLC, ...y.map((v, i) => chain(head, i, d[i], 255, v))));
}
export function verify(
  s: Signer,
  signature: Uint8Array,
  message: Uint8Array,
  key: Uint8Array,
  stepLimit = Infinity,
): boolean {
  const candidate = candidateKey(s, message, signature, stepLimit);
  return candidate !== null && equal(candidate, key);
}
