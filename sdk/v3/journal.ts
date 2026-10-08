/** Protocol 3 operational signing journal (DRAFT).
 *
 * A one-time key must never sign two different messages. Before signing with
 * `K[epoch][opIndex]` the tuple is reserved here; the signed announcement is
 * then saved so an interrupted upload resumes the SAME bytes. If a reservation
 * exists with no saved signature, or the announcement can no longer land, this
 * journal refuses to sign again and the user recovers to a new epoch instead.
 * Refusing is safe because recovery exists.
 *
 * The journal only moves forward. It remembers every tuple it has reserved,
 * not just the latest, so a network connection that shows an older state of
 * the vault (by fault or on purpose) gets back the bytes already signed for
 * that state, or a refusal, and never a second signature.
 *
 * Same limits as before: this coordinates one browser profile only. */
import { z } from "zod";
import { hex, unhex } from "../bytes";
import { operationalRoot, signAnnouncement } from "./authority";
import type { Descriptor } from "./derive";
import { Announce, encodeAnnounce, MAX_ANNOUNCE_AHEAD_SECS, VaultState } from "./protocol";
const entry = z
  .object({
    version: z.literal(3),
    epoch: z.string(),
    opIndex: z.string(),
    status: z.enum(["reserved", "signed"]),
    payload: z.string().optional(),
    message: z.string().optional(),
    signature: z.string().optional(),
    /** Token withdrawals only: the wallet that owns the destination token account. */
    recipient: z.string().optional(),
    /** The fee wallet that began uploading this signature. The upload lives at
     * an address derived from that wallet, so finishing with another wallet
     * means paying for a second upload. */
    payer: z.string().optional(),
  })
  .strict();
export type JournalEntry = z.infer<typeof entry>;
/** Every tuple reserved in this browser. `entries` keeps the signed bytes of
 * the most recent ones; `used` keeps, per epoch, the highest index reserved,
 * for good. */
const journal = z
  .object({
    version: z.literal(3),
    entries: z.array(entry).max(64),
    used: z.record(z.string().regex(/^(0|[1-9][0-9]*)$/), z.string().regex(/^(0|[1-9][0-9]*)$/)),
  })
  .strict();
export type Journal = z.infer<typeof journal>;
const KEPT_ENTRIES = 16;
export type VaultIdentity = { genesis: string; program: string; vault: string };
export const journalKey = (k: VaultIdentity) =>
  `bunker3-journal:${k.genesis}:${k.program}:${k.vault}`;
const used = (e: JournalEntry) => ({ [e.epoch]: e.opIndex });
/** Throws if the stored journal is unreadable: an unreadable journal means
 * this browser no longer knows what it signed, so it must not sign. */
export function readJournal(k: VaultIdentity): Journal {
  const raw = localStorage.getItem(journalKey(k));
  if (raw === null) return { version: 3, entries: [], used: {} };
  const parsed = JSON.parse(raw);
  // The earlier single-entry format.
  if (parsed && typeof parsed === "object" && "status" in parsed) {
    const e = entry.parse(parsed);
    return { version: 3, entries: [e], used: used(e) };
  }
  return journal.parse(parsed);
}
function write(k: VaultIdentity, j: Journal) {
  const encoded = JSON.stringify(journal.parse(j));
  localStorage.setItem(journalKey(k), encoded);
  if (localStorage.getItem(journalKey(k)) !== encoded)
    throw new Error("Cannot persist the signing journal");
}
const at = (j: Journal, chain: Pick<VaultState, "epoch" | "opIndex">) =>
  j.entries.find(
    (e) => BigInt(e.epoch) === chain.epoch && BigInt(e.opIndex) === chain.opIndex,
  );
/** Adds or replaces the entry for its tuple and raises the high-water mark. */
function record(j: Journal, e: JournalEntry): Journal {
  const others = j.entries.filter((x) => x.epoch !== e.epoch || x.opIndex !== e.opIndex);
  const high = j.used[e.epoch];
  return {
    version: 3,
    entries: [...others, e].slice(-KEPT_ENTRIES),
    used: {
      ...j.used,
      [e.epoch]: high !== undefined && BigInt(high) > BigInt(e.opIndex) ? high : e.opIndex,
    },
  };
}
async function locked<T>(k: VaultIdentity, fn: () => Promise<T>): Promise<T> {
  if (!navigator.locks) throw new Error("Web Locks are required for signing");
  return navigator.locks.request(journalKey(k), { mode: "exclusive" }, fn);
}
export type SignedAnnouncement = {
  payload: Uint8Array;
  message: Uint8Array;
  signature: Uint8Array;
  recipient?: string;
  payer?: string;
};
const saved = (e: JournalEntry): SignedAnnouncement => ({
  payload: unhex(e.payload!),
  message: unhex(e.message!),
  signature: unhex(e.signature!),
  recipient: e.recipient,
  payer: e.payer,
});
/** Remembers which fee wallet began uploading a signed announcement. Changes
 * nothing about what was signed; the first wallet recorded stays. */
export async function notePayer(
  k: VaultIdentity,
  tuple: { epoch: bigint; opIndex: bigint },
  payer: string,
): Promise<void> {
  await locked(k, async () => {
    const j = readJournal(k);
    const e = at(j, tuple);
    if (!e || e.status !== "signed" || e.payer) return;
    write(k, record(j, { ...e, payer }));
  });
}
/** What this browser knows about the operational key the chain says is
 * current.
 *  - `signed`: this key already signed; only those bytes may be sent.
 *  - `orphaned`: reserved, signature lost. Recover.
 *  - `behind`: the chain view is older than what this browser has signed for,
 *    or names a key this browser used and no longer holds the bytes for. */
export function journalStatus(
  k: VaultIdentity,
  chain: Pick<VaultState, "epoch" | "opIndex">,
):
  | { state: "unused" }
  | { state: "signed"; announcement: SignedAnnouncement }
  | { state: "orphaned" }
  | { state: "behind" } {
  const j = readJournal(k);
  const e = at(j, chain);
  if (e)
    return e.status === "signed"
      ? { state: "signed", announcement: saved(e) }
      : { state: "orphaned" };
  for (const [epoch, high] of Object.entries(j.used))
    if (
      BigInt(epoch) > chain.epoch ||
      (BigInt(epoch) === chain.epoch && BigInt(high) >= chain.opIndex)
    )
      return { state: "behind" };
  return { state: "unused" };
}
/** `journalStatus` for rendering: a journal that cannot be read is reported,
 * not thrown. */
export function safeJournalStatus(
  k: VaultIdentity,
  chain: Pick<VaultState, "epoch" | "opIndex">,
): ReturnType<typeof journalStatus> | { state: "unreadable" } {
  try {
    return journalStatus(k, chain);
  } catch {
    return { state: "unreadable" };
  }
}
const REFUSAL = {
  signed: "This key already signed a withdrawal. Finish announcing it, or recover to a new key.",
  orphaned:
    "This key was reserved but its signature was not saved. Recover to a new key; do not sign again.",
  behind:
    "The network is showing an older state of your Bunker than this browser has already signed for. Nothing was signed. Refresh, and if it persists, recover to a new key.",
} as const;
/** Reserves the current key, signs once, saves the result. Never signs a key
 * this browser has already reserved. */
export async function authorizeAnnouncement(
  k: VaultIdentity,
  seed: Uint8Array,
  d: Descriptor,
  chain: VaultState,
  withdrawal: Pick<Announce, "kind" | "mint" | "destination" | "amount" | "announceBy" | "decimals">,
  recipient?: string,
): Promise<SignedAnnouncement> {
  return locked(k, async () => {
    if (chain.pending) throw new Error("A withdrawal is already pending");
    const status = journalStatus(k, chain);
    if (status.state !== "unused") throw new Error(REFUSAL[status.state]);
    // The chain must name exactly the key this seed derives for this tuple. A
    // view of the vault that this day key does not belong to is never signed for.
    const expected = operationalRoot(seed, d, chain.epoch, chain.opIndex);
    if (hex(expected) !== hex(chain.opRoot))
      throw new Error(
        "This day key does not match the Bunker’s current key. Nothing was signed. Use the newest day key from the recovery tool.",
      );
    // The deadline comes from the network's clock; bound it by this device's.
    const local = BigInt(Math.floor(Date.now() / 1000));
    if (withdrawal.announceBy > local + MAX_ANNOUNCE_AHEAD_SECS || withdrawal.announceBy <= local)
      throw new Error(
        "The network’s clock and this device’s clock are too far apart to set a safe deadline. Nothing was signed. Check this device’s date and time; if they are right, the network is reporting the wrong time, so try again later or on another connection.",
      );
    // Anything that would make the message invalid is found now, before the
    // key is reserved, so a bad request cannot use a key up.
    encodeAnnounce({
      ...withdrawal,
      vaultId: d.vaultId,
      chainTag: d.chainTag,
      epoch: chain.epoch,
      opIndex: chain.opIndex,
      nextOpRoot: expected,
    });
    const tuple = {
      version: 3 as const,
      epoch: chain.epoch.toString(),
      opIndex: chain.opIndex.toString(),
    };
    // Reserved BEFORE any signature byte exists.
    write(k, record(readJournal(k), { ...tuple, status: "reserved" }));
    const signed = signAnnouncement(seed, d, {
      ...withdrawal,
      epoch: chain.epoch,
      opIndex: chain.opIndex,
    });
    write(
      k,
      record(readJournal(k), {
        ...tuple,
        status: "signed",
        payload: hex(signed.payload),
        message: hex(signed.message),
        signature: hex(signed.signature),
        ...(recipient ? { recipient } : {}),
      }),
    );
    return { ...signed, recipient };
  });
}
