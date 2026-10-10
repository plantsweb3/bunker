/** Everything Bunker Watch remembers. All of it is public chain data or a
 * setting: there is no key, password or file of any kind in here.
 *
 * It is written against a three-method store so the same code runs on
 * chrome.storage.local in the extension and on a plain map in tests. */
import type { PendingView, Snapshot, WatchEvent } from "@/lib/alerts/watch";
import { MAX_WATCHED } from "./config";

export type KV = {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
};
export const chromeStore = (): KV => ({
  get: (keys) => chrome.storage.local.get(keys),
  set: (items) => chrome.storage.local.set(items),
  remove: (keys) => chrome.storage.local.remove(keys),
});
export function memoryStore(seed: Record<string, unknown> = {}): KV & { data: Map<string, unknown> } {
  const data = new Map(Object.entries(seed));
  return {
    data,
    get: async (keys) => Object.fromEntries(keys.filter((k) => data.has(k)).map((k) => [k, structuredClone(data.get(k))])),
    set: async (items) => void Object.entries(items).forEach(([k, v]) => data.set(k, structuredClone(v))),
    remove: async (keys) => void keys.forEach((k) => data.delete(k)),
  };
}

/** What the popup shows for one Bunker, as of the last successful read. */
export type View = {
  address: string;
  lamports: string;
  epoch: string;
  opIndex: string;
  delaySecs: number;
  /** A waiting withdrawal, and whether it goes to one of the Bunker's trusted addresses. */
  pending: (PendingView & { trusted: boolean }) | null;
  /** Chain time of the read, in seconds. */
  checkedAt: string;
  /** Set when the last pass could not read this Bunker. The rest is then from an earlier pass. */
  problem?: string;
};
/** An alert that has been decided on and not yet shown. */
export type Notice = {
  /** The same alert always has the same id, so showing it twice replaces it. */
  id: string;
  vault: string;
  kind: WatchEvent["kind"] | "blind";
  title: string;
  message: string;
  /** Stays on screen until dismissed. */
  urgent: boolean;
};
export type LogEntry = { at: string; vault: string; kind: Notice["kind"]; title: string; text: string };
export type Status = {
  /** Wall-clock milliseconds of the last pass that read the network. */
  passAt: number | null;
  /** Chain time at that pass, in seconds. */
  chainNow: string | null;
  /** The slot that pass was answered from. An answer from an earlier slot is not used. */
  slot: number;
  problem: string | null;
  /** After a refusal for asking too often: do not ask again before this. */
  retryAt: number;
  refusals: number;
  /** Wall-clock milliseconds since which no pass has read the network. */
  failingSince: number | null;
  /** The owner has been told that Bunker Watch cannot see. */
  toldBlind: boolean;
};
/** After this long without a reading, the badge and a notification say so. */
export const BLIND_AFTER_MS = 5 * 60_000;
/** Chain time now: the last pass's reading, plus this computer's clock since.
 * With no reading at all, this computer's clock. */
export function chainNow(s: Status, wallClock = Date.now()): bigint {
  if (!s.chainNow || !s.passAt) return BigInt(Math.floor(wallClock / 1000));
  return BigInt(s.chainNow) + BigInt(Math.max(0, Math.floor((wallClock - s.passAt) / 1000)));
}
export const blind = (s: Status, wallClock = Date.now()) =>
  s.failingSince !== null && wallClock - s.failingSince >= BLIND_AFTER_MS;
export type Settings = { rpc: string | null };
const LOG_KEPT = 30;
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const snapKey = (a: string) => `snapshot:${a}`;
const viewKey = (a: string) => `view:${a}`;

async function one<T>(kv: KV, key: string, fallback: T): Promise<T> {
  const got = (await kv.get([key]))[key];
  return got === undefined ? fallback : (got as T);
}
export async function watched(kv: KV): Promise<string[]> {
  const list = await one<unknown>(kv, "watched", []);
  return Array.isArray(list) ? list.filter((a): a is string => typeof a === "string" && ADDRESS.test(a)).slice(0, MAX_WATCHED) : [];
}
/** Starts watching a Bunker that has just been read and checked. */
export async function watch(kv: KV, address: string, snapshot: Snapshot, view: View) {
  const list = await watched(kv);
  if (list.includes(address)) throw new Error("You are already watching that Bunker.");
  if (list.length >= MAX_WATCHED) throw new Error(`You can watch up to ${MAX_WATCHED} Bunkers. Stop watching one first.`);
  await kv.set({ watched: [...list, address], [snapKey(address)]: snapshot, [viewKey(address)]: view });
}
export async function unwatch(kv: KV, address: string) {
  await kv.set({ watched: (await watched(kv)).filter((a) => a !== address) });
  await kv.remove([snapKey(address), viewKey(address)]);
}
export async function snapshots(kv: KV, addresses: string[]): Promise<(Snapshot | null)[]> {
  const got = await kv.get(addresses.map(snapKey));
  return addresses.map((a) => {
    const s = got[snapKey(a)] as Snapshot | undefined;
    try {
      // Throws on anything that is not a whole number.
      for (const n of [s!.epoch, s!.opIndex, s!.lamports]) BigInt(n);
      return s!.v === 1 ? s! : null;
    } catch {
      return null;
    }
  });
}
export async function views(kv: KV): Promise<View[]> {
  const list = await watched(kv);
  const got = await kv.get(list.map(viewKey));
  return list.flatMap((a) => (got[viewKey(a)] ? [got[viewKey(a)] as View] : []));
}
/** Records a reading together with the alerts it calls for, in one write.
 * The snapshot moving and the alert being queued cannot come apart: if the
 * browser stops the extension right after this, the alert is still in the
 * outbox and is shown the next time it wakes. */
export async function saveRead(kv: KV, address: string, snapshot: Snapshot, view: View, notices: Notice[] = [], at = "0") {
  const entries: LogEntry[] = notices.map((n) => ({ at, vault: n.vault, kind: n.kind, title: n.title, text: n.message }));
  await kv.set({
    [snapKey(address)]: snapshot,
    [viewKey(address)]: view,
    ...(notices.length ? { outbox: [...(await outbox(kv)), ...notices], log: [...entries.reverse(), ...(await log(kv))].slice(0, LOG_KEPT) } : {}),
  });
}
export const outbox = (kv: KV) => one<Notice[]>(kv, "outbox", []);
export const queue = async (kv: KV, notice: Notice) => kv.set({ outbox: [...(await outbox(kv)).filter((n) => n.id !== notice.id), notice] });
export const shown = async (kv: KV, id: string) => kv.set({ outbox: (await outbox(kv)).filter((n) => n.id !== id) });
/** Forgets readings of Bunkers that are no longer watched. */
export async function forget(kv: KV, addresses: string[]) {
  const kept = await watched(kv);
  const gone = addresses.filter((a) => !kept.includes(a));
  if (gone.length) await kv.remove(gone.flatMap((a) => [snapKey(a), viewKey(a)]));
}
export async function markProblem(kv: KV, address: string, problem: string) {
  const view = await one<View | null>(kv, viewKey(address), null);
  if (view) await kv.set({ [viewKey(address)]: { ...view, problem } });
}
const FRESH: Status = { passAt: null, chainNow: null, slot: 0, problem: null, retryAt: 0, refusals: 0, failingSince: null, toldBlind: false };
export const status = async (kv: KV): Promise<Status> => ({ ...FRESH, ...(await one<Partial<Status>>(kv, "status", {})) });
export const setStatus = (kv: KV, s: Status) => kv.set({ status: s });
export const log = (kv: KV) => one<LogEntry[]>(kv, "log", []);
export const settings = (kv: KV) => one<Settings>(kv, "settings", { rpc: null });
export const setSettings = (kv: KV, s: Settings) => kv.set({ settings: s });
/** Waiting withdrawals the owner has said were theirs, by the record's digest. */
export const acknowledged = (kv: KV) => one<string[]>(kv, "acknowledged", []);
export async function acknowledge(kv: KV, digest: string) {
  await kv.set({ acknowledged: [digest, ...(await acknowledged(kv)).filter((d) => d !== digest)].slice(0, 20) });
}
