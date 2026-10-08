/** One pass of the alert watcher.
 *
 * Alerts come from what the vault account IS, not from which transactions
 * mention it. Each pass reads every watched vault's account, compares it with
 * the snapshot taken on the previous pass, and reports the difference. Nothing
 * an outsider sends can hide a change (there is no transaction list to flood
 * or to route around through another program), and nothing an outsider sends
 * can fake one (only the program can change a vault account).
 *
 * The snapshot moves only after an event's messages have been attempted, so a
 * crash mid-pass can repeat an alert. A delivery that Telegram refuses (the
 * user blocked the bot, an outage) is counted and NOT retried: alerts are best
 * effort, and one unreachable chat must not hold up or duplicate the others. */
import { Connection, PublicKey } from "@solana/web3.js";
import { hex } from "@/sdk/bytes";
import { chainTime } from "@/sdk/v3/chain";
import { parseVault, vaultAddress, VaultState } from "@/sdk/v3/protocol";
import { eventText } from "./messages";
import type { WatchStore } from "./store";
export type Send = (chat: string, text: string) => Promise<void>;
export type WatchResult = {
  vaults: number;
  events: number;
  messages: number;
  errors: number;
  skipped?: "busy";
};
export type PendingView = {
  kind: 0 | 1;
  mint: string;
  destination: string;
  amount: string;
  opensAt: string;
  deadline: string;
  digest: string;
};
export type Snapshot = {
  v: 1;
  epoch: string;
  opIndex: string;
  lamports: string;
  pending: PendingView | null;
};
export type WatchEvent =
  /** `cancelled`: a waiting withdrawal the recovery certainly stopped.
   * `unresolved`: one that was either stopped or released just before it. */
  | { kind: "recovered"; cancelled: PendingView | null; unresolved: PendingView | null }
  | { kind: "announced"; pending: PendingView }
  /** `count` withdrawals completed. `record` is known when one had been
   * announced earlier; otherwise `lamports` is the SOL that left, if any. */
  | { kind: "left"; count: number; record: PendingView | null; lamports: bigint }
  /** A record ended after its deadline: released at the last moment, or cleared. */
  | { kind: "ended"; record: PendingView }
  /** The SOL balance is lower and nothing above accounts for it. */
  | { kind: "fell"; lamports: bigint }
  | { kind: "deposit"; lamports: bigint };
/** Smaller SOL arrivals are not reported, so dust cannot be used to spam a chat. */
export const MIN_DEPOSIT_ALERT_LAMPORTS = 1_000_000n;
const BATCH = 100;
export function snapshotOf(state: VaultState, lamports: bigint): Snapshot {
  const p = state.pending;
  return {
    v: 1,
    epoch: state.epoch.toString(),
    opIndex: state.opIndex.toString(),
    lamports: lamports.toString(),
    pending: p && {
      kind: p.kind,
      mint: p.mint.toBase58(),
      destination: p.destination.toBase58(),
      amount: p.amount.toString(),
      opensAt: p.opensAt.toString(),
      deadline: p.deadline.toString(),
      digest: hex(p.digest),
    },
  };
}
function readSnapshot(raw: string | null): Snapshot | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Snapshot;
    // Throws on anything that is not a whole number.
    for (const n of [s.epoch, s.opIndex, s.lamports]) BigInt(n);
    return s.v === 1 ? s : null;
  } catch {
    return null;
  }
}
/** What happened between two snapshots of one vault, in the order it happened.
 *
 * Only two snapshots are known, so some histories look alike. Where they do,
 * the event says so rather than guess: a withdrawal is called cancelled only
 * when the balance shows it did not leave. */
export function diff(prev: Snapshot, cur: Snapshot, now: bigint): WatchEvent[] {
  const events: WatchEvent[] = [];
  const net = BigInt(prev.lamports) - BigInt(cur.lamports);
  // SOL that left and has not yet been attributed to a known record.
  let unexplained = net > 0n ? net : 0n;
  /** Whether a recorded SOL withdrawal fits in what left. Null for a token. */
  const fits = (p: PendingView) => {
    if (p.kind !== 0) return null;
    const amount = BigInt(p.amount);
    if (unexplained < amount) return false;
    unexplained -= amount;
    return true;
  };
  const fresh = cur.pending && cur.pending.digest !== prev.pending?.digest ? cur.pending : null;
  const others = (done: number) => {
    if (done > 0) {
      events.push({ kind: "left", count: done, record: null, lamports: unexplained });
      unexplained = 0n;
    }
  };
  if (BigInt(cur.epoch) > BigInt(prev.epoch)) {
    const p = prev.pending;
    const released = p ? fits(p) : false;
    if (p && released === true) events.push({ kind: "left", count: 1, record: p, lamports: 0n });
    events.push({
      kind: "recovered",
      cancelled: p && released === false ? p : null,
      unresolved: p && released === null ? p : null,
    });
    // Anything announced under the new keys since.
    others(Number(BigInt(cur.opIndex)) - (fresh ? 1 : 0));
    // Withdrawals made under the old keys before the recovery leave no count
    // behind, only a lower balance.
    if (unexplained > 0n) events.push({ kind: "fell", lamports: unexplained });
  } else {
    if (prev.pending && prev.pending.digest !== cur.pending?.digest) {
      // Release is only possible up to the deadline; clearing only after it.
      if (now <= BigInt(prev.pending.deadline)) {
        fits(prev.pending);
        events.push({ kind: "left", count: 1, record: prev.pending, lamports: 0n });
      } else events.push({ kind: "ended", record: prev.pending });
    }
    // Announced and already completed between two passes (no waiting period).
    others(Number(BigInt(cur.opIndex) - BigInt(prev.opIndex)) - (fresh ? 1 : 0));
  }
  if (fresh) events.push({ kind: "announced", pending: fresh });
  if (events.length === 0 && -net >= MIN_DEPOSIT_ALERT_LAMPORTS)
    events.push({ kind: "deposit", lamports: -net });
  return events;
}
export async function runWatch(options: {
  store: WatchStore;
  connection: Connection;
  program: PublicKey;
  send: Send;
  /** A page where the vault can be inspected. */
  link: (vault: string) => string | null;
  maxVaults?: number;
  /** Stop starting new batches after this long, so the pass ends inside the
   * platform's time limit. */
  budgetMs?: number;
  log?: (message: string) => void;
}): Promise<WatchResult> {
  const { store, connection, program, send, link } = options;
  const log = options.log ?? ((m: string) => console.error(`[alerts] ${m}`));
  const result: WatchResult = { vaults: 0, events: 0, messages: 0, errors: 0 };
  // The scheduler can start a pass while the last one is still running.
  if (!(await store.lock(50))) return { ...result, skipped: "busy" };
  const max = options.maxVaults ?? 1000;
  const deadline = Date.now() + (options.budgetMs ?? 40_000);
  const seen = new Set<string>();
  let now: bigint | null = null;
  // One batch at a time. The store's turn only advances past vaults that
  // were actually taken, so a pass that runs out of time leaves the rest
  // first in line for the next pass instead of skipping them.
  while (seen.size < max && Date.now() < deadline) {
    const batch = (await store.nextVaults(Math.min(BATCH, max - seen.size))).filter(
      (v) => !seen.has(v),
    );
    // Wrapped round to vaults already read in this pass: every one is done.
    if (batch.length === 0) break;
    for (const v of batch) seen.add(v);
    now ??= await chainTime(connection);
    let infos: Awaited<ReturnType<Connection["getMultipleAccountsInfo"]>>;
    let previous: (string | null)[];
    try {
      [infos, previous] = await Promise.all([
        connection.getMultipleAccountsInfo(batch.map((a) => new PublicKey(a))),
        store.snapshots(batch),
      ]);
    } catch (e) {
      result.errors += batch.length;
      log(`batch read failed: ${e instanceof Error ? e.message : "unknown"}`);
      continue;
    }
    for (let j = 0; j < batch.length; j++) {
      const address = batch[j];
      result.vaults++;
      try {
        const info = infos[j];
        if (!info || !info.owner.equals(program)) throw new Error("not a Bunker account");
        const state = parseVault(info.data);
        if (!vaultAddress(program, state.vaultId).equals(new PublicKey(address)))
          throw new Error("address does not match identity");
        const cur = snapshotOf(state, BigInt(info.lamports));
        const prev = readSnapshot(previous[j]);
        const encoded = JSON.stringify(cur);
        if (!prev) {
          // First sight of this vault: start from now.
          await store.setSnapshot(address, encoded);
          continue;
        }
        const events = diff(prev, cur, now);
        if (events.length > 0) {
          const chats = await store.chatsOf(address);
          // Nobody is listening: a subscription that was only half removed.
          if (chats.length === 0) {
            await store.forget(address);
            continue;
          }
          for (const event of events) {
            result.events++;
            const text = eventText(address, event, now, link(address));
            for (const chat of chats) {
              try {
                await send(chat, text);
                result.messages++;
              } catch {
                result.errors++;
                log(`delivery failed for ${address.slice(0, 8)}`);
              }
            }
          }
        }
        if (encoded !== JSON.stringify(prev)) await store.setSnapshot(address, encoded);
      } catch (e) {
        result.errors++;
        log(`${address.slice(0, 8)}: ${e instanceof Error ? e.message : "unknown"}`);
      }
    }
  }
  return result;
}
