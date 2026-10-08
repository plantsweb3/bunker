/** Protocol 3 secret derivation (docs/PROTOCOL.md §1.1). DRAFT: not
 * reviewed, not used by the released app.
 *
 * One archival master `M` derives everything. An operational signer is given
 * only an epoch seed `S[e]`, from which it cannot compute `M`, any recovery
 * key, or another epoch's seed. */
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { concat, u64 } from "../bytes";
import { SECRET_BYTES } from "../winternitz";
export const MASTER_BYTES = 32;
export const SEED_BYTES = 32;
const LABEL = new TextEncoder().encode("BUNKER-KDF-3");
const ROLE_RECOVERY = 0x01;
const ROLE_EPOCH_SEED = 0x02;
const ROLE_OPERATIONAL = 0x03;
const NO_SALT = new Uint8Array(0);
/** Everything a derivation is bound to. All three are 32 bytes. `salt` is the
 * random value chosen when the kit is made; it is public once the vault exists. */
export type KeyContext = {
  chainTag: Uint8Array;
  programId: Uint8Array;
  salt: Uint8Array;
  /** The vault's waiting period. Part of what the vault IS, so part of what
   * its keys are bound to: the same master and salt with another waiting
   * period derive unrelated keys. */
  delaySecs: number;
};
/** A key context plus the identity of the vault its genesis keys create. The
 * identity is a hash over the genesis commitments (protocol.ts `vaultIdOf`),
 * so it cannot itself be an input to deriving them. */
export type Descriptor = KeyContext & { vaultId: Uint8Array };
const index = (n: bigint) => {
  if (n < 0n || n > 0xffffffffffffffffn) throw new Error("Index out of range");
  return u64(n);
};
/** `"BUNKER-KDF-3" || 0x00 || chain_tag || program_id || salt || delay_secs`,
 * 113 bytes. Every input of the vault identity except the roots themselves. */
export function context(d: KeyContext): Uint8Array {
  for (const part of [d.chainTag, d.programId, d.salt])
    if (part.length !== 32) throw new Error("Descriptor fields are 32 bytes");
  if (!Number.isInteger(d.delaySecs) || d.delaySecs < 0 || d.delaySecs > 0xffffffff)
    throw new Error("Invalid waiting period");
  const delay = new Uint8Array(4);
  new DataView(delay.buffer).setUint32(0, d.delaySecs, true);
  return concat(LABEL, new Uint8Array([0]), d.chainTag, d.programId, d.salt, delay);
}
function expand(ikm: Uint8Array, expected: number, info: Uint8Array, length: number) {
  if (ikm.length !== expected) throw new Error("Invalid key material length");
  return hkdf(sha256, ikm, NO_SALT, info, length);
}
/** `R[e]`: signs exactly one message, the recovery packet for epoch `e`. */
export function recoveryKey(master: Uint8Array, d: KeyContext, epoch: bigint) {
  return expand(
    master,
    MASTER_BYTES,
    concat(context(d), new Uint8Array([ROLE_RECOVERY]), index(epoch)),
    SECRET_BYTES,
  );
}
/** `S[e]`: the only secret an operational signer holds. */
export function epochSeed(master: Uint8Array, d: KeyContext, epoch: bigint) {
  return expand(
    master,
    MASTER_BYTES,
    concat(context(d), new Uint8Array([ROLE_EPOCH_SEED]), index(epoch)),
    SEED_BYTES,
  );
}
/** `K[e][i]`: authorizes at most one announcement. */
export function operationalKey(
  seed: Uint8Array,
  d: KeyContext,
  epoch: bigint,
  opIndex: bigint,
) {
  return expand(
    seed,
    SEED_BYTES,
    concat(
      context(d),
      new Uint8Array([ROLE_OPERATIONAL]),
      index(epoch),
      index(opIndex),
    ),
    SECRET_BYTES,
  );
}
