/** Protocol 3 operational signing journal (DRAFT).
 *
 * A one-time key must never sign two different messages. Before signing with
 * `K[epoch][opIndex]` the tuple is reserved here; the signed announcement is
 * then saved so an interrupted upload resumes the SAME bytes. If a reservation
 * exists with no saved signature, or the announcement can no longer land, this
 * journal refuses to sign again and the user recovers to a new epoch instead.
 * That is the difference from protocol 2: refusing is safe, because recovery
 * exists.
 *
 * Same limits as before: this coordinates one browser profile only. */
import { z } from "zod";
import { hex, unhex } from "../bytes";
import { signAnnouncement } from "./authority";
import type { Descriptor } from "./derive";
import type { Announce, VaultState } from "./protocol";
const entry = z
  .object({
    version: z.literal(3),
    epoch: z.string(),
    opIndex: z.string(),
    status: z.enum(["reserved", "signed"]),
    payload: z.string().optional(),
    message: z.string().optional(),
    signature: z.string().optional(),
  })
  .strict();
export type JournalEntry = z.infer<typeof entry>;
export type VaultIdentity = { genesis: string; program: string; vault: string };
export const journalKey = (k: VaultIdentity) =>
  `bunker3-journal:${k.genesis}:${k.program}:${k.vault}`;
export function readJournal(k: VaultIdentity): JournalEntry | null {
  const raw = localStorage.getItem(journalKey(k));
  return raw === null ? null : entry.parse(JSON.parse(raw));
}
function write(k: VaultIdentity, e: JournalEntry) {
  const encoded = JSON.stringify(entry.parse(e));
  localStorage.setItem(journalKey(k), encoded);
  if (localStorage.getItem(journalKey(k)) !== encoded)
    throw new Error("Cannot persist the signing journal");
}
async function locked<T>(k: VaultIdentity, fn: () => Promise<T>): Promise<T> {
  if (!navigator.locks) throw new Error("Web Locks are required for signing");
  return navigator.locks.request(journalKey(k), { mode: "exclusive" }, fn);
}
export type SignedAnnouncement = {
  payload: Uint8Array;
  message: Uint8Array;
  signature: Uint8Array;
};
const saved = (e: JournalEntry): SignedAnnouncement => ({
  payload: unhex(e.payload!),
  message: unhex(e.message!),
  signature: unhex(e.signature!),
});
/** What this browser knows about the vault's current operational key. */
export function journalStatus(
  k: VaultIdentity,
  chain: Pick<VaultState, "epoch" | "opIndex">,
):
  | { state: "unused" }
  | { state: "signed"; announcement: SignedAnnouncement }
  | { state: "orphaned" } {
  const e = readJournal(k);
  // An entry for an earlier tuple was accepted or superseded on-chain.
  if (
    !e ||
    BigInt(e.epoch) !== chain.epoch ||
    BigInt(e.opIndex) !== chain.opIndex
  )
    return { state: "unused" };
  return e.status === "signed"
    ? { state: "signed", announcement: saved(e) }
    : { state: "orphaned" };
}
/** Reserves the current key, signs once, saves the result. Never signs a key
 * this browser has already reserved. */
export async function authorizeAnnouncement(
  k: VaultIdentity,
  seed: Uint8Array,
  d: Descriptor,
  chain: VaultState,
  withdrawal: Pick<Announce, "kind" | "mint" | "destination" | "amount" | "announceBy">,
): Promise<SignedAnnouncement> {
  return locked(k, async () => {
    if (chain.pending) throw new Error("A withdrawal is already pending");
    const status = journalStatus(k, chain);
    if (status.state !== "unused")
      throw new Error(
        status.state === "signed"
          ? "This key already signed a withdrawal. Finish announcing it, or recover to a new key."
          : "This key was reserved but its signature was not saved. Recover to a new key; do not sign again.",
      );
    const tuple = {
      version: 3 as const,
      epoch: chain.epoch.toString(),
      opIndex: chain.opIndex.toString(),
    };
    // Reserved BEFORE any signature byte exists.
    write(k, { ...tuple, status: "reserved" });
    const signed = signAnnouncement(seed, d, {
      ...withdrawal,
      epoch: chain.epoch,
      opIndex: chain.opIndex,
    });
    write(k, {
      ...tuple,
      status: "signed",
      payload: hex(signed.payload),
      message: hex(signed.message),
      signature: hex(signed.signature),
    });
    return signed;
  });
}
