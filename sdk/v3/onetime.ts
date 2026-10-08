/** How Bunker uses LM-OTS (docs/PROTOCOL.md §1.3): which identifier each key
 * signs under, where the randomizer comes from, and the limit the program puts
 * on verification cost. */
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { concat, u64 } from "../bytes";
import {
  IDENTIFIER_BYTES,
  publicKey,
  RANDOMIZER_BYTES,
  SECRET_BYTES,
  sign,
  Signer,
  verificationSteps,
  verify,
} from "../lmots";
/** A derived one-time key: the 34 chain starts, then a seed for randomizers. */
export const ONE_TIME_BYTES = SECRET_BYTES + 32;
/** The program's `VERIFY_STEP_LIMIT`. A signature that would take more chain
 * steps than this to verify is refused, so the signer picks a randomizer that
 * stays within it. A little over one randomizer in four does. */
export const VERIFY_STEP_LIMIT = 4080;
/** The role byte of the signed payload, which also names the signer. */
export const SIGNS_ANNOUNCEMENTS = 1;
export const SIGNS_RECOVERY = 2;
const text = (s: string) => new TextEncoder().encode(s);
const IDENTIFIER_DOMAIN = text("BUNKER3_LMOTS_ID");
const RANDOMIZER_LABEL = text("BUNKER-LMOTS-C");
const NO_SALT = new Uint8Array(0);
/** What a signer's identifier is computed from. All three are public. */
export type SignerContext = { programId: Uint8Array; chainTag: Uint8Array; salt: Uint8Array };

/** The signer of one key. `I` is fixed by the program, the chain, the vault's
 * salt, the role, the key generation and the operation index (zero for a
 * recovery key); `q` is always zero, as RFC 8554 section 4 requires of LM-OTS
 * used outside an LMS tree. The program computes the same identifier from the
 * vault account, so a signature made for any other position is refused. */
export function signerOf(
  c: SignerContext,
  role: typeof SIGNS_ANNOUNCEMENTS | typeof SIGNS_RECOVERY,
  epoch: bigint,
  index: bigint,
): Signer {
  for (const part of [c.programId, c.chainTag, c.salt])
    if (part.length !== 32) throw new Error("Signer fields are 32 bytes");
  if (role === SIGNS_RECOVERY && index !== 0n) throw new Error("A recovery key has no index");
  const identifier = sha256(
    concat(
      IDENTIFIER_DOMAIN,
      c.programId,
      c.chainTag,
      c.salt,
      new Uint8Array([role]),
      u64(epoch),
      u64(index),
    ),
  ).slice(0, IDENTIFIER_BYTES);
  return { identifier, q: 0 };
}
const secretOf = (material: Uint8Array) => {
  if (material.length !== ONE_TIME_BYTES) throw new Error("Invalid one-time key length");
  return material.subarray(0, SECRET_BYTES);
};
/** The public key ("root") the vault stores for this key. Consumes its input. */
export function rootOf(material: Uint8Array, s: Signer): Uint8Array {
  try {
    return publicKey(s, secretOf(material));
  } finally {
    material.fill(0);
  }
}
/** The `n`th candidate randomizer of a key, from the seed that ends it. */
export function randomizerAt(seed: Uint8Array, n: number): Uint8Array {
  if (seed.length !== 32) throw new Error("Invalid randomizer seed");
  const counter = new Uint8Array(4);
  new DataView(counter.buffer).setUint32(0, n, true);
  return hkdf(sha256, seed, NO_SALT, concat(RANDOMIZER_LABEL, counter), RANDOMIZER_BYTES);
}
/** Signs `message` with a derived key. The randomizer is the first of a fixed
 * sequence, derived from the key itself, that keeps verification within the
 * program's limit; signing the same message again gives the same bytes.
 *
 * Internal primitive. The caller MUST have reserved this exact message for
 * this key before calling. Consumes its input. */
export function signOnce(material: Uint8Array, s: Signer, message: Uint8Array): Uint8Array {
  try {
    const secret = secretOf(material);
    const seed = material.subarray(SECRET_BYTES);
    for (let n = 0; n < 0x10000; n++) {
      const randomizer = randomizerAt(seed, n);
      if (verificationSteps(s, randomizer, message) <= VERIFY_STEP_LIMIT)
        return sign(s, secret, randomizer, message);
    }
    // 65,536 misses at better than one in four: this does not happen.
    throw new Error("Could not sign within the verification limit");
  } finally {
    material.fill(0);
  }
}
/** Whether the program would accept `signature` over `message` for `root`. */
export const verifies = (s: Signer, signature: Uint8Array, message: Uint8Array, root: Uint8Array) =>
  verify(s, signature, message, root, VERIFY_STEP_LIMIT);
