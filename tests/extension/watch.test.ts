import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { DEVNET_GENESIS } from "../../lib/bunker-config";
import { MAX_WATCHED, NEVER_ASKS } from "../../extension/src/config";
import { CREAM, ICE } from "../../extension/src/notify";
import { endpoint } from "../../extension/src/rpc";
import * as store from "../../extension/src/store";
import { addVault, runPass } from "../../extension/src/watch";
import { chain, id, NOW, PROGRAM } from "./chain";

const waiting = { amount: 10_000_000_000n, opensAt: NOW + 85_267n, deadline: NOW + 2n * 86_400n, digest: 9 };
/** One pass, then what the background worker would show: the outbox, emptied. */
async function pass(kv: store.KV, connection: Parameters<typeof runPass>[1], wallClock?: number) {
  const result = await runPass(kv, connection, wallClock);
  const notices = await store.outbox(kv);
  for (const n of notices) await store.shown(kv, n.id);
  return { ...result, notices };
}
const destination = new PublicKey(id(6)).toBase58();

describe("Bunker Watch: one pass", () => {
  it("announces a withdrawal once, turns the badge cream, and then says nothing", async () => {
    const kv = store.memoryStore();
    const c = chain();
    await addVault(kv, c.connection, c.address());
    // A recorded state with no withdrawal waiting.
    const quiet = await pass(kv, c.connection);
    expect(quiet.notices).toEqual([]);
    expect(quiet.badge).toEqual({ text: "1", color: ICE });
    // The same vault, now with a withdrawal waiting.
    c.of().pending = waiting;
    c.of().opIndex = 12n;
    const announced = await pass(kv, c.connection);
    expect(announced.notices).toHaveLength(1);
    expect(announced.notices[0]).toMatchObject({ kind: "announced", urgent: true, title: "Withdrawal announced" });
    expect(announced.notices[0].message).toBe(
      `A withdrawal was announced from Bunker ${c.address().slice(0, 4)}…${c.address().slice(-4)}. 10 SOL to ${destination}. Opens in 23h 41m. ` +
        `If this was not you, cancel it now with your cancel file or recovery kit. ${NEVER_ASKS}`,
    );
    expect(announced.badge).toEqual({ text: "24h", color: CREAM });
    // A third, identical pass.
    const again = await pass(kv, c.connection);
    expect(again.notices).toEqual([]);
    expect(again.badge.color).toBe(CREAM);
    expect(await store.log(kv)).toHaveLength(1);
    const [view] = await store.views(kv);
    expect(view.pending).toMatchObject({ amount: "10000000000", trusted: false });
  });
  it("says when a waiting withdrawal goes to one of the Bunker's trusted addresses", async () => {
    const kv = store.memoryStore();
    const c = chain();
    await addVault(kv, c.connection, c.address());
    c.of().trusted = [id(6)];
    c.of().pending = waiting;
    await pass(kv, c.connection);
    expect((await store.views(kv))[0].pending?.trusted).toBe(true);
  });
  it("uses the alert service's own wording for everything else, and always says what Bunker never asks for", async () => {
    const kv = store.memoryStore();
    const c = chain();
    await addVault(kv, c.connection, c.address());
    c.of().lamports += 2_000_000_000;
    const { notices } = await pass(kv, c.connection);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ kind: "deposit", urgent: false });
    expect(notices[0].title).toContain("deposit received");
    expect(notices[0].message).toContain("+2 SOL");
    expect(notices[0].message).toContain("Bunker will never ask for your recovery kit");
    for (const text of [notices[0].title, notices[0].message]) expect(text).not.toContain("—");
  });
  it("shows what was already waiting when watching starts, without announcing it", async () => {
    const kv = store.memoryStore();
    const c = chain();
    c.of().pending = waiting;
    const view = await addVault(kv, c.connection, c.address());
    expect(view.pending?.digest).toBeTruthy();
    expect((await pass(kv, c.connection)).notices).toEqual([]);
  });
});

describe("Bunker Watch: what it refuses", () => {
  it("refuses an RPC whose genesis is not mainnet, and stores nothing", async () => {
    const kv = store.memoryStore();
    const elsewhere = chain([id(7)], DEVNET_GENESIS);
    await expect(addVault(kv, elsewhere.connection, elsewhere.address())).rejects.toThrow("not Solana mainnet");
    expect(kv.data.size).toBe(0);
    // Nothing but the genesis hash was asked for.
    expect(elsewhere.asked).toEqual(["getGenesisHash"]);
  });
  it("stops reading, and keeps what it had, if the RPC turns out not to be mainnet later", async () => {
    const kv = store.memoryStore();
    const c = chain();
    await addVault(kv, c.connection, c.address());
    await pass(kv, c.connection);
    const kept = structuredClone([...kv.data.entries()].filter(([k]) => k !== "status"));
    const elsewhere = chain([id(7)], DEVNET_GENESIS);
    elsewhere.of().pending = waiting;
    const result = await pass(kv, elsewhere.connection);
    expect(result.notices).toEqual([]);
    expect(elsewhere.asked).toEqual(["getGenesisHash"]);
    expect([...kv.data.entries()].filter(([k]) => k !== "status")).toEqual(kept);
    expect((await store.status(kv)).problem).toContain("not Solana mainnet");
  });
  it("cannot add an address that is not a vault of the mainnet program", async () => {
    const kv = store.memoryStore();
    const c = chain();
    // No account at all, an account of another program, and a Bunker account at the wrong address.
    await expect(addVault(kv, c.connection, new PublicKey(id(8)).toBase58())).rejects.toThrow("No Bunker found");
    c.of().owner = new PublicKey(id(12));
    await expect(addVault(kv, c.connection, c.address())).rejects.toThrow("No Bunker found");
    await expect(addVault(kv, c.connection, "not an address")).rejects.toThrow("not a Solana address");
    const moved = chain([id(7), id(8)]);
    const real = moved.connection as unknown as { getAccountInfo(k: PublicKey): Promise<unknown> };
    const swap = { ...real, getAccountInfo: async (k: PublicKey) => real.getAccountInfo(k.toBase58() === moved.address(1) ? new PublicKey(moved.address(0)) : k) };
    await expect(addVault(kv, swap as never, moved.address(1))).rejects.toThrow("does not match");
    expect(await store.watched(kv)).toEqual([]);
    expect(PROGRAM.toBase58()).toBe("DGXACBwbUqRKRVR1TQojZBoRuV2TZJ8wVnQSuLKm2nJJ");
  });
  it("watches at most five, and each only once", async () => {
    const kv = store.memoryStore();
    const c = chain([1, 2, 3, 4, 5, 6].map((n) => id(20 + n)));
    for (let n = 0; n < MAX_WATCHED; n++) await addVault(kv, c.connection, c.address(n));
    await expect(addVault(kv, c.connection, c.address(0))).rejects.toThrow("already watching");
    await expect(addVault(kv, c.connection, c.address(5))).rejects.toThrow("up to 5");
    await store.unwatch(kv, c.address(0));
    await addVault(kv, c.connection, c.address(5));
    expect(await store.watched(kv)).toHaveLength(5);
  });
  it("takes only an https endpoint with nothing hidden in it", () => {
    expect(endpoint(" https://rpc.example/key ").href).toBe("https://rpc.example/key");
    for (const bad of ["http://rpc.example", "http://127.0.0.1:8899", "ws://rpc.example", "https://user:pw@rpc.example", "rpc.example", ""])
      expect(() => endpoint(bad), bad).toThrow();
  });
});

describe("Bunker Watch: an alert that has been decided on is not lost", () => {
  it("queues the alert in the same write as the reading, so stopping in between loses nothing", async () => {
    const kv = store.memoryStore();
    const c = chain();
    await addVault(kv, c.connection, c.address());
    c.of().pending = waiting;
    // The pass runs, and the browser stops the extension before anything is shown.
    await runPass(kv, c.connection);
    expect((await store.outbox(kv)).map((n) => n.kind)).toEqual(["announced"]);
    // Next wake: the reading has not changed, so nothing new is decided, and the alert is still waiting to be shown.
    await runPass(kv, c.connection);
    const waitingToShow = await store.outbox(kv);
    expect(waitingToShow).toHaveLength(1);
    expect(waitingToShow[0].id).toBe(`announced:${c.address()}:${"09".repeat(32)}`);
    await store.shown(kv, waitingToShow[0].id);
    expect(await store.outbox(kv)).toEqual([]);
  });
  it("does not move the snapshot if the write that carries the alert fails", async () => {
    const kv = store.memoryStore();
    const c = chain();
    await addVault(kv, c.connection, c.address());
    c.of().pending = waiting;
    const set = kv.set;
    kv.set = async (items) => {
      if ("outbox" in items) throw new Error("storage is full");
      return set(items);
    };
    await runPass(kv, c.connection);
    expect(await store.outbox(kv)).toEqual([]);
    kv.set = set;
    // The reading was not recorded either, so the next pass announces it.
    expect((await pass(kv, c.connection)).notices.map((n) => n.kind)).toEqual(["announced"]);
  });
});

describe("Bunker Watch: when the network is unwell", () => {
  it("says so, once, when it has not been able to look for five minutes, and stops saying so when it can", async () => {
    const kv = store.memoryStore();
    const c = chain();
    const t0 = 5_000_000;
    await addVault(kv, c.connection, c.address(), t0);
    c.fail(new Error("fetch failed"));
    const early = await pass(kv, c.connection, t0 + 60_000);
    expect(early.notices).toEqual([]);
    expect(early.badge).toEqual({ text: "1", color: ICE });
    await pass(kv, c.connection, t0 + 240_000);
    const blindPass = await pass(kv, c.connection, t0 + 60_000 + 300_000);
    expect(blindPass.notices.map((n) => n.kind)).toEqual(["blind"]);
    expect(blindPass.notices[0].message).toContain("would not see a withdrawal being announced");
    expect(blindPass.badge).toEqual({ text: "!", color: CREAM });
    // Still blind: the badge stays, the notification is not repeated.
    const still = await pass(kv, c.connection, t0 + 600_000);
    expect(still.notices).toEqual([]);
    expect(still.badge.text).toBe("!");
    c.fail(null);
    expect((await pass(kv, c.connection, t0 + 660_000)).badge).toEqual({ text: "1", color: ICE });
    // A later outage is told again.
    c.fail(new Error("fetch failed"));
    await pass(kv, c.connection, t0 + 720_000);
    expect((await pass(kv, c.connection, t0 + 720_000 + 300_000)).notices.map((n) => n.kind)).toEqual(["blind"]);
  });
  it("keeps the badge's countdown moving while it cannot read, and never starts it from nothing", async () => {
    const kv = store.memoryStore();
    const c = chain();
    c.of().pending = { ...waiting, opensAt: NOW + 7_000n };
    const t0 = 9_000_000;
    await addVault(kv, c.connection, c.address(), t0);
    c.fail(new Error("fetch failed"));
    // The first pass after adding fails: the hours come from the reading taken when it was added.
    expect((await pass(kv, c.connection, t0 + 1_000)).badge.text).toBe("2h");
    expect((await pass(kv, c.connection, t0 + 3_600_000)).badge.text).toBe("!");
    const status = await store.status(kv);
    expect(store.chainNow(status, t0 + 3_600_000)).toBe(NOW + 3_600n);
  });
  it("does not use an answer from an older state than the last one", async () => {
    const kv = store.memoryStore();
    const c = chain();
    await addVault(kv, c.connection, c.address());
    c.of().pending = waiting;
    await pass(kv, c.connection);
    // A node that is behind: it has not seen the announcement yet.
    c.of().pending = null;
    c.at.slot = 5;
    const behind = await pass(kv, c.connection);
    expect(behind.notices).toEqual([]);
    expect((await store.views(kv))[0].pending).not.toBeNull();
    expect((await store.status(kv)).problem).toContain("older state");
  });
  it("backs off when the endpoint asks for fewer requests, and recovers", async () => {
    const kv = store.memoryStore();
    const c = chain();
    await addVault(kv, c.connection, c.address());
    const t0 = 1_000_000;
    c.fail(new Error("429 Too Many Requests"));
    await pass(kv, c.connection, t0);
    expect((await store.status(kv)).retryAt).toBe(t0 + 60_000);
    const asked = c.asked.length;
    expect((await pass(kv, c.connection, t0 + 30_000)).skipped).toBe("waiting to retry");
    expect(c.asked.length).toBe(asked);
    await pass(kv, c.connection, t0 + 60_000);
    expect((await store.status(kv)).retryAt).toBe(t0 + 60_000 + 120_000);
    // However often it is refused, it looks again within five minutes.
    let at = t0 + 180_000;
    for (let n = 0; n < 6; n++) {
      await runPass(kv, c.connection, at);
      const wait = (await store.status(kv)).retryAt - at;
      expect(wait).toBeLessThanOrEqual(300_000);
      at += wait;
    }
    c.fail(null);
    c.of().pending = waiting;
    const back = await pass(kv, c.connection, at);
    expect(back.notices.map((n) => n.kind)).toContain("announced");
    expect(await store.status(kv)).toMatchObject({ problem: null, refusals: 0, retryAt: 0, failingSince: null });
  });
  it("keeps the last good reading and says so when one Bunker cannot be read", async () => {
    const kv = store.memoryStore();
    const c = chain([id(7), id(8)]);
    await addVault(kv, c.connection, c.address(0));
    await addVault(kv, c.connection, c.address(1));
    c.of(1).owner = new PublicKey(id(12));
    c.of(0).pending = waiting;
    const result = await pass(kv, c.connection);
    expect(result.notices.map((n) => n.vault)).toEqual([c.address(0)]);
    const [, broken] = await store.views(kv);
    expect(broken.problem).toContain("no Bunker at this address");
    expect(broken.lamports).toBe("12400000000");
  });
});
