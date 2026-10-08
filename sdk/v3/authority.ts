/** Signing with an operational key (docs/PROTOCOL.md §3.1). Takes an epoch
 * seed, never the master. Everything computed from the master lives in
 * `master.ts` and is re-exported here for callers that want one import. */
import { PublicKey } from "@solana/web3.js";
import { signOnce } from "../winternitz";
import { Descriptor, operationalKey } from "./derive";
import { operationalRoot } from "./master";
import { Announce, announceMessage, encodeAnnounce } from "./protocol";
export { genesisAuthorities, genesisVault, operationalRoot, recoveryPacket } from "./master";
const program = (d: Descriptor) => new PublicKey(d.programId);
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
