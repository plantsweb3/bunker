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
  | { kind: "recovered"; cancelled: PendingView | null }
  | { kind: "announced"; pending: PendingView }
  /** `count` withdrawals completed. `record` is known when one had been announced earlier. */
  | { kind: "left"; count: number; record: PendingView | null; lamports: bigint }
  /** A record ended after its deadline: released at the last moment, or cleared. */
  | { kind: "ended"; record: PendingView }
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
/** What happened between two snapshots of one vault, in the order it happened. */
export function diff(prev: Snapshot, cur: Snapshot, now: bigint): WatchEvent[] {
  const events: WatchEvent[] = [];
  const drop = BigInt(prev.lamports) - BigInt(cur.lamports);
  const left = (count: number, record: PendingView | null) =>
    events.push({ kind: "left", count, record, lamports: drop > 0n ? drop : 0n });
  const fresh = cur.pending && cur.pending.digest !== prev.pending?.digest ? cur.pending : null;
  if (BigInt(cur.epoch) > BigInt(prev.epoch)) {
    events.push({ kind: "recovered", cancelled: prev.pending });
    // Anything announced under the new keys since.
    const done = Number(BigInt(cur.opIndex)) - (fresh ? 1 : 0);
    if (done > 0) left(done, null);
  } else {
    if (prev.pending && prev.pending.digest !== cur.pending?.digest) {
      // Release is only possible up to the deadline; clearing only after it.
      if (now <= BigInt(prev.pending.deadline)) left(1, prev.pending);
      else events.push({ kind: "ended", record: prev.pending });
    }
    // Announced and already completed between two passes (no waiting period).
    const done = Number(BigInt(cur.opIndex) - BigInt(prev.opIndex)) - (fresh ? 1 : 0);
    if (done > 0) left(done, null);
  }
  if (fresh) events.push({ kind: "announced", pending: fresh });
  if (events.length === 0 && -drop >= MIN_DEPOSIT_ALERT_LAMPORTS)
    events.push({ kind: "deposit", lamports: -drop });
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
  log?: (message: string) => void;
}): Promise<WatchResult> {
  const { store, connection, program, send, link } = options;
  const log = options.log ?? ((m: string) => console.error(`[alerts] ${m}`));
  const result: WatchResult = { vaults: 0, events: 0, messages: 0, errors: 0 };
  // The scheduler can start a pass while the last one is still running.
  if (!(await store.lock(50))) return { ...result, skipped: "busy" };
  const vaults = await store.nextVaults(options.maxVaults ?? 1000);
  if (vaults.length === 0) return result;
  const now = await chainTime(connection);
  for (let i = 0; i < vaults.length; i += BATCH) {
    const batch = vaults.slice(i, i + BATCH);
    let infos: Awaited<ReturnType<Connection["getMultipleAccountsInfo"]>>;
    try {
      infos = await connection.getMultipleAccountsInfo(batch.map((a) => new PublicKey(a)));
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
        const prev = readSnapshot(await store.snapshot(address));
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
