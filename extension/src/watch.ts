/** One pass of Bunker Watch, and adding a Bunker to the list.
 *
 * The comparing is not done here. `snapshotOf` and `diff` are the alert
 * service's own, from lib/alerts/watch.ts, unchanged: an alert comes from
 * what the vault account is, compared with what it was a minute ago, so
 * nothing anyone sends can hide a change or fake one.
 *
 * A pass keeps nothing in memory between runs. The browser may stop and
 * restart the extension at any time, so everything is read from and written
 * to the store. A reading and the alerts it calls for are written together,
 * into an outbox; showing them is a separate step that can be repeated. */
import { type Connection, PublicKey, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import { diff, snapshotOf, type Snapshot } from "@/lib/alerts/watch";
import { chainTime, fetchVault, toTrusted } from "@/sdk/v3/chain";
import { parseVault, vaultAddress, type VaultState } from "@/sdk/v3/protocol";
import { NETWORK } from "./config";
import { badgeOf, blindNotice, noticeOf } from "./notify";
import { assertGenesis, refused, WrongNetwork } from "./rpc";
import * as store from "./store";

type Reads = Pick<
  Connection,
  "getGenesisHash" | "getAccountInfo" | "getMultipleAccountsInfoAndContext" | "getMinimumBalanceForRentExemption"
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
export async function addVault(kv: store.KV, connection: Reads, raw: string, wallClock = Date.now()): Promise<store.View> {
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
  // The network was just read, so the clock the badge and the popup count from is fresh.
  const before = await store.status(kv);
  await store.setStatus(kv, { ...before, passAt: wallClock, chainNow: now.toString(), problem: null, failingSince: null, toldBlind: false });
  return view;
}
export type PassResult = {
  badge: { text: string; color: string };
  /** The network was not asked: nothing is watched, or the endpoint asked us to wait. */
  skipped?: "nothing watched" | "waiting to retry";
};
const MINUTE = 60_000;
/** Reads every watched Bunker once. Alerts go to the outbox; see `store.outbox`. */
export async function runPass(kv: store.KV, connection: Reads, wallClock = Date.now()): Promise<PassResult> {
  const list = await store.watched(kv);
  const before = await store.status(kv);
  const done = async (skipped?: PassResult["skipped"]): Promise<PassResult> => {
    const status = await store.status(kv);
    return { badge: badgeOf(await store.views(kv), store.chainNow(status, wallClock), status, wallClock), skipped };
  };
  /** A pass that could not read. After a few minutes of these, the owner is told. */
  const failed = async (
    problem: string,
    refusals = 0,
    // One minute, then two, then four, and no longer than five: a watcher
    // that waits half an hour to look again is not watching.
    retryAt = refusals ? wallClock + Math.min(2 ** (refusals - 1), 5) * MINUTE : 0,
  ) => {
    const failingSince = before.failingSince ?? wallClock;
    const status: store.Status = { ...before, problem, refusals, retryAt, failingSince, toldBlind: before.toldBlind };
    if (store.blind(status, wallClock) && !status.toldBlind) {
      await store.queue(kv, blindNotice(failingSince));
      status.toldBlind = true;
    }
    await store.setStatus(kv, status);
  };
  if (list.length === 0) return done("nothing watched");
  if (wallClock < before.retryAt) {
    // Still counts as time without a reading; the wait itself is left as it was.
    await failed(before.problem ?? "Waiting before asking the RPC endpoint again.", before.refusals, before.retryAt);
    return done("waiting to retry");
  }

  let now: bigint;
  let slot: number;
  let infos: Awaited<ReturnType<Connection["getMultipleAccountsInfo"]>>;
  try {
    await assertGenesis(connection);
    // The clock and the accounts in one answer, from one slot.
    const read = await connection.getMultipleAccountsInfoAndContext([SYSVAR_CLOCK_PUBKEY, ...list.map((a) => new PublicKey(a))]);
    slot = read.context.slot;
    const [clock, ...accounts] = read.value;
    now = await chainTime({ getAccountInfo: async () => clock } as unknown as Connection);
    infos = accounts;
  } catch (e) {
    const refusals = refused(e) ? before.refusals + 1 : 0;
    await failed(
      e instanceof WrongNetwork
        ? e.message
        : refusals
          ? "The RPC endpoint asked for fewer requests. Bunker Watch is waiting before it asks again."
          : "The network could not be read. Bunker Watch will try again in a minute.",
      refusals,
    );
    return done();
  }
  // A node that is behind the one that answered last time would show an
  // older state, and comparing with it would report changes that did not happen.
  if (slot < before.slot) {
    await failed("The RPC endpoint answered from an older state than before. That answer was not used.");
    return done();
  }

  const previous = await store.snapshots(kv, list);
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
      const notices = (prior ? diff(prior, current, now) : []).map((event) => noticeOf(address, event, now));
      await store.saveRead(kv, address, current, await viewOf(address, state, current, now), notices, now.toString());
    } catch (e) {
      await store.markProblem(kv, address, e instanceof Error ? e.message : "This Bunker could not be read.").catch(() => undefined);
    }
  }
  // A Bunker the owner stopped watching while this pass was reading it.
  await store.forget(kv, list).catch(() => undefined);
  await store.setStatus(kv, {
    passAt: wallClock,
    chainNow: now.toString(),
    slot,
    problem: null,
    retryAt: 0,
    refusals: 0,
    failingSince: null,
    toldBlind: false,
  });
  return done();
}
