/** Everything that is computed from the archival master (docs/PROTOCOL.md
 * §1 and §3.2). This module and what it imports are all the offline recovery
 * tool needs to derive keys and sign; none of it depends on a Solana client
 * library.
 *
 * `recoveryPacket` has NO free inputs beyond the vault descriptor and epoch.
 * It is the only thing a recovery key signs. */
import { rootFromSecret, signOnce } from "../winternitz";
import { encodeRecover, recoverMessageBytes, vaultIdOf } from "./core";
import { Descriptor, epochSeed, KeyContext, operationalKey, recoveryKey } from "./derive";
/** The roots a new vault is created with, and the first epoch's seed. */
export function genesisAuthorities(master: Uint8Array, d: KeyContext) {
  const seed = epochSeed(master, d, 0n);
  return {
    opRoot: rootFromSecret(operationalKey(seed, d, 0n, 0n)),
    recRoot: rootFromSecret(recoveryKey(master, d, 0n)),
    seed,
  };
}
/** Everything needed to create a vault from a master: its genesis roots and
 * the descriptor whose `vaultId` commits to them and to the waiting period. */
export function genesisVault(master: Uint8Array, k: KeyContext) {
  const genesis = genesisAuthorities(master, k);
  const d: Descriptor = {
    chainTag: k.chainTag,
    programId: k.programId,
    salt: k.salt,
    delaySecs: k.delaySecs,
    trusted: k.trusted,
    vaultId: vaultIdOf({ ...k, opRoot: genesis.opRoot, recRoot: genesis.recRoot }),
  };
  return { ...genesis, d, delaySecs: k.delaySecs };
}
export const operationalRoot = (
  seed: Uint8Array,
  d: KeyContext,
  epoch: bigint,
  opIndex: bigint,
) => rootFromSecret(operationalKey(seed, d, epoch, opIndex));
/** The single recovery packet for `epoch`. Calling it again yields identical
 * bytes; there is no other message this key may sign. Also returns the next
 * epoch's seed for a clean operational signer. */
export function recoveryPacket(master: Uint8Array, d: Descriptor, epoch: bigint) {
  const nextSeed = epochSeed(master, d, epoch + 1n);
  const payload = encodeRecover({
    vaultId: d.vaultId,
    chainTag: d.chainTag,
    epoch,
    nextRecRoot: rootFromSecret(recoveryKey(master, d, epoch + 1n)),
    nextOpRoot: rootFromSecret(operationalKey(nextSeed, d, epoch + 1n, 0n)),
  });
  const message = recoverMessageBytes(d.programId, payload);
  return {
    payload,
    message,
    signature: signOnce(recoveryKey(master, d, epoch), message),
    nextSeed,
  };
}
