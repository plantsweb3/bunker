/** Protocol 3 authorities built from derived keys (docs/PROTOCOL.md
 * §3). DRAFT: not reviewed, not used by the released app.
 *
 * Two deliberately different surfaces:
 *  - `recoveryPacket` takes the archival master and has NO free inputs beyond
 *    the vault descriptor and epoch. It is the only thing the master signs.
 *  - `signAnnouncement` takes an epoch seed, never the master. */
import { PublicKey } from "@solana/web3.js";
import { rootFromSecret, signOnce } from "../winternitz";
import { Descriptor, epochSeed, operationalKey, recoveryKey } from "./derive";
import {
  Announce,
  announceMessage,
  encodeAnnounce,
  encodeRecover,
  recoverMessage,
} from "./protocol";
const program = (d: Descriptor) => new PublicKey(d.programId);
/** The roots a new vault is created with, and the first epoch's seed. */
export function genesisAuthorities(master: Uint8Array, d: Descriptor) {
  const seed = epochSeed(master, d, 0n);
  return {
    opRoot: rootFromSecret(operationalKey(seed, d, 0n, 0n)),
    recRoot: rootFromSecret(recoveryKey(master, d, 0n)),
    seed,
  };
}
export const operationalRoot = (
  seed: Uint8Array,
  d: Descriptor,
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
  const message = recoverMessage(program(d), payload);
  return {
    payload,
    message,
    signature: signOnce(recoveryKey(master, d, epoch), message),
    nextSeed,
  };
}
/** Signs one announcement with `K[epoch][opIndex]`. The caller MUST have
 * durably recorded this `(epoch, opIndex)` as consumed before calling: a
 * second, different message under the same key breaks the scheme. The next
 * operational root is derived here and cannot be supplied. */
export function signAnnouncement(
  seed: Uint8Array,
  d: Descriptor,
  a: Omit<Announce, "vaultId" | "chainTag" | "nextOpRoot">,
) {
  const payload = encodeAnnounce({
    ...a,
    vaultId: d.vaultId,
    chainTag: d.chainTag,
    nextOpRoot: operationalRoot(seed, d, a.epoch, a.opIndex + 1n),
  });
  const message = announceMessage(program(d), payload);
  return {
    payload,
    message,
    signature: signOnce(operationalKey(seed, d, a.epoch, a.opIndex), message),
  };
}
