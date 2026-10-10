/** One pass of Bunker Watch, and adding a Bunker to the list.
 *
 * The comparing is not done here. `snapshotOf` and `diff` are the alert
 * service's own, from lib/alerts/watch.ts, unchanged: an alert comes from
 * what the vault account is, compared with what it was a minute ago, so
 * nothing anyone sends can hide a change or fake one.
 *
 * A pass keeps nothing in memory between runs. The browser may stop and
 * restart the extension at any time, so everything is read from and written
 * to the store. */
import { type Connection, PublicKey } from "@solana/web3.js";
import { diff, snapshotOf, type Snapshot } from "@/lib/alerts/watch";
import { chainTime, fetchVault, toTrusted } from "@/sdk/v3/chain";
import { parseVault, vaultAddress, type VaultState } from "@/sdk/v3/protocol";
import { NETWORK } from "./config";
import { badgeOf, noticeOf, type Notice } from "./notify";
import { assertGenesis, refused, WrongNetwork } from "./rpc";
import * as store from "./store";

type Reads = Pick<
  Connection,
  "getGenesisHash" | "getAccountInfo" | "getMultipleAccountsInfo" | "getMinimumBalanceForRentExemption"
>;
const program = () => new PublicKey(NETWORK.program);

async function viewOf(address: string, state: VaultState, snapshot: Snapshot, now: bigint): Promise<store.View> {
  return {
    address,
    lamports: snapshot.lamports,
    epoch: snapshot.epoch,
    opIndex: snapshot.opIndex,
    delaySecs: state.delaySecs,
    pending: snapshot.pending && { ...snapshot.pending, trusted: await toTrusted(state, state.pending!) },
    checkedAt: now.toString(),
  };
}
/** Checks that `address` is a Bunker of the pinned program on the pinned
 * network, then starts watching it. A waiting withdrawal that is already
 * there when watching starts is shown, not announced. */
export async function addVault(kv: store.KV, connection: Reads, raw: string): Promise<store.View> {
  let address: PublicKey;
  try {
    address = new PublicKey(raw.trim());
  } catch {
    throw new Error("That is not a Solana address. Paste the Bunker's full address.");
  }
  await assertGenesis(connection);
  // Refuses anything that is not owned by the program, or whose address is
  // not the address of the identity stored in it.
  const { state, lamports } = await fetchVault(connection as Connection, program(), address);
  const now = await chainTime(connection as Connection);
  const snapshot = snapshotOf(state, lamports);
  const view = await viewOf(address.toBase58(), state, snapshot, now);
  await store.watch(kv, address.toBase58(), snapshot, view);
  return view;
}
export type PassResult = {
  notices: Notice[];
  badge: { text: string; color: string };
  /** The network was not asked: nothing is watched, or the endpoint asked us to wait. */
  skipped?: "nothing watched" | "waiting to retry";
};
const MINUTE = 60_000;
export async function runPass(kv: store.KV, connection: Reads, wallClock = Date.now()): Promise<PassResult> {
  const list = await store.watched(kv);
  const before = await store.status(kv);
  const shown = () => store.views(kv);
  const idle = async (skipped: PassResult["skipped"]): Promise<PassResult> => ({
    notices: [],
    badge: badgeOf(await shown(), BigInt(before.chainNow ?? 0)),
    skipped,
  });
  if (list.length === 0) return idle("nothing watched");
  if (wallClock < before.retryAt) return idle("waiting to retry");

  let now: bigint;
  let infos: Awaited<ReturnType<Connection["getMultipleAccountsInfo"]>>;
  try {
    await assertGenesis(connection);
    now = await chainTime(connection as Connection);
    infos = await connection.getMultipleAccountsInfo(list.map((a) => new PublicKey(a)));
  } catch (e) {
    const refusals = refused(e) ? before.refusals + 1 : 0;
    await store.setStatus(kv, {
      ...before,
      refusals,
      // One minute, then two, four, eight, up to half an hour.
      retryAt: refusals ? wallClock + Math.min(2 ** (refusals - 1), 30) * MINUTE : 0,
      problem:
        e instanceof WrongNetwork
          ? e.message
          : refusals
            ? "The RPC endpoint asked for fewer requests. Bunker Watch is waiting before it asks again."
            : "The network could not be read. Bunker Watch will try again in a minute.",
    });
    return idle(undefined);
  }

  const previous = await store.snapshots(kv, list);
  const notices: Notice[] = [];
  const entries: store.LogEntry[] = [];
  for (let i = 0; i < list.length; i++) {
    const address = list[i];
    try {
      const info = infos[i];
      if (!info || !info.owner.equals(program())) throw new Error("There is no Bunker at this address any more.");
      const state = parseVault(info.data);
      if (!vaultAddress(program(), state.vaultId).equals(new PublicKey(address)))
        throw new Error("The account at this address is not the Bunker it claims to be.");
      const current = snapshotOf(state, BigInt(info.lamports));
      const prior = previous[i];
      for (const event of prior ? diff(prior, current, now) : []) {
        const notice = noticeOf(address, event, now);
        notices.push(notice);
        entries.push({ at: now.toString(), vault: address, kind: event.kind, title: notice.title, text: notice.message });
      }
      await store.saveRead(kv, address, current, await viewOf(address, state, current, now));
    } catch (e) {
      await store.markProblem(kv, address, e instanceof Error ? e.message : "This Bunker could not be read.");
    }
  }
  await store.addToLog(kv, entries);
  await store.setStatus(kv, { passAt: wallClock, chainNow: now.toString(), problem: null, retryAt: 0, refusals: 0 });
  return { notices, badge: badgeOf(await shown(), now) };
}
