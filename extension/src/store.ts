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
export type LogEntry = { at: string; vault: string; kind: WatchEvent["kind"]; title: string; text: string };
export type Status = {
  /** Wall-clock milliseconds of the last pass that read the network. */
  passAt: number | null;
  /** Chain time at that pass, in seconds. */
  chainNow: string | null;
  problem: string | null;
  /** After a refusal for asking too often: do not ask again before this. */
  retryAt: number;
  refusals: number;
};
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
export const saveRead = (kv: KV, address: string, snapshot: Snapshot, view: View) =>
  kv.set({ [snapKey(address)]: snapshot, [viewKey(address)]: view });
export async function markProblem(kv: KV, address: string, problem: string) {
  const view = await one<View | null>(kv, viewKey(address), null);
  if (view) await kv.set({ [viewKey(address)]: { ...view, problem } });
}
export const status = (kv: KV) =>
  one<Status>(kv, "status", { passAt: null, chainNow: null, problem: null, retryAt: 0, refusals: 0 });
export const setStatus = (kv: KV, s: Status) => kv.set({ status: s });
export const log = (kv: KV) => one<LogEntry[]>(kv, "log", []);
export async function addToLog(kv: KV, entries: LogEntry[]) {
  if (entries.length) await kv.set({ log: [...entries.reverse(), ...(await log(kv))].slice(0, LOG_KEPT) });
}
export const settings = (kv: KV) => one<Settings>(kv, "settings", { rpc: null });
export const setSettings = (kv: KV, s: Settings) => kv.set({ settings: s });
/** Waiting withdrawals the owner has said were theirs, by the record's digest. */
export const acknowledged = (kv: KV) => one<string[]>(kv, "acknowledged", []);
export async function acknowledge(kv: KV, digest: string) {
  await kv.set({ acknowledged: [digest, ...(await acknowledged(kv)).filter((d) => d !== digest)].slice(0, 20) });
}
