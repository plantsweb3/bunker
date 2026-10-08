/** Protocol 3 secret derivation (docs/PROTOCOL-3-DRAFT.md §1.1). DRAFT: not
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
/** Everything a derivation is bound to. All three are 32 bytes. */
export type Descriptor = {
  chainTag: Uint8Array;
  programId: Uint8Array;
  vaultId: Uint8Array;
};
const index = (n: bigint) => {
  if (n < 0n || n > 0xffffffffffffffffn) throw new Error("Index out of range");
  return u64(n);
};
/** `"BUNKER-KDF-3" || 0x00 || chain_tag || program_id || vault_id`, 109 bytes. */
export function context(d: Descriptor): Uint8Array {
  for (const part of [d.chainTag, d.programId, d.vaultId])
    if (part.length !== 32) throw new Error("Descriptor fields are 32 bytes");
  return concat(LABEL, new Uint8Array([0]), d.chainTag, d.programId, d.vaultId);
}
function expand(ikm: Uint8Array, expected: number, info: Uint8Array, length: number) {
  if (ikm.length !== expected) throw new Error("Invalid key material length");
  return hkdf(sha256, ikm, NO_SALT, info, length);
}
/** `R[e]`: signs exactly one message, the recovery packet for epoch `e`. */
export function recoveryKey(master: Uint8Array, d: Descriptor, epoch: bigint) {
  return expand(
    master,
    MASTER_BYTES,
    concat(context(d), new Uint8Array([ROLE_RECOVERY]), index(epoch)),
    SECRET_BYTES,
  );
}
/** `S[e]`: the only secret an operational signer holds. */
export function epochSeed(master: Uint8Array, d: Descriptor, epoch: bigint) {
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
  d: Descriptor,
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
