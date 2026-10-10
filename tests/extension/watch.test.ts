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

describe("Bunker Watch: one pass", () => {
  it("announces a withdrawal once, turns the badge cream, and then says nothing", async () => {
    const kv = store.memoryStore();
    const c = chain();
    await addVault(kv, c.connection, c.address());
    // A recorded state with no withdrawal waiting.
    const quiet = await runPass(kv, c.connection);
    expect(quiet.notices).toEqual([]);
    expect(quiet.badge).toEqual({ text: "1", color: ICE });
    // The same vault, now with a withdrawal waiting.
    c.of().pending = waiting;
    c.of().opIndex = 12n;
    const announced = await runPass(kv, c.connection);
    expect(announced.notices).toHaveLength(1);
    expect(announced.notices[0]).toMatchObject({ kind: "announced", urgent: true, title: "Withdrawal announced" });
    expect(announced.notices[0].message).toBe(
      `A withdrawal was announced from Bunker ${c.address().slice(0, 4)}…${c.address().slice(-4)}. Opens in 23h 41m. ` +
        `If this was not you, cancel it now with your cancel file or recovery kit. ${NEVER_ASKS}`,
    );
    expect(announced.badge).toEqual({ text: "24h", color: CREAM });
    // A third, identical pass.
    const again = await runPass(kv, c.connection);
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
    await runPass(kv, c.connection);
    expect((await store.views(kv))[0].pending?.trusted).toBe(true);
  });
  it("uses the alert service's own wording for everything else, and always says what Bunker never asks for", async () => {
    const kv = store.memoryStore();
    const c = chain();
    await addVault(kv, c.connection, c.address());
    c.of().lamports += 2_000_000_000;
    const { notices } = await runPass(kv, c.connection);
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
    expect((await runPass(kv, c.connection)).notices).toEqual([]);
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
    await runPass(kv, c.connection);
    const kept = structuredClone([...kv.data.entries()].filter(([k]) => k !== "status"));
    const elsewhere = chain([id(7)], DEVNET_GENESIS);
    elsewhere.of().pending = waiting;
    const pass = await runPass(kv, elsewhere.connection);
    expect(pass.notices).toEqual([]);
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

describe("Bunker Watch: when the network is unwell", () => {
  it("backs off when the endpoint asks for fewer requests, and recovers", async () => {
    const kv = store.memoryStore();
    const c = chain();
    await addVault(kv, c.connection, c.address());
    const t0 = 1_000_000;
    c.fail(new Error("429 Too Many Requests"));
    await runPass(kv, c.connection, t0);
    expect((await store.status(kv)).retryAt).toBe(t0 + 60_000);
    const asked = c.asked.length;
    expect((await runPass(kv, c.connection, t0 + 30_000)).skipped).toBe("waiting to retry");
    expect(c.asked.length).toBe(asked);
    await runPass(kv, c.connection, t0 + 60_000);
    expect((await store.status(kv)).retryAt).toBe(t0 + 60_000 + 120_000);
    c.fail(null);
    c.of().pending = waiting;
    const back = await runPass(kv, c.connection, t0 + 200_000);
    expect(back.notices).toHaveLength(1);
    expect(await store.status(kv)).toMatchObject({ problem: null, refusals: 0, retryAt: 0 });
  });
  it("keeps the last good reading and says so when one Bunker cannot be read", async () => {
    const kv = store.memoryStore();
    const c = chain([id(7), id(8)]);
    await addVault(kv, c.connection, c.address(0));
    await addVault(kv, c.connection, c.address(1));
    c.of(1).owner = new PublicKey(id(12));
    c.of(0).pending = waiting;
    const pass = await runPass(kv, c.connection);
    expect(pass.notices.map((n) => n.vault)).toEqual([c.address(0)]);
    const [, broken] = await store.views(kv);
    expect(broken.problem).toContain("no Bunker at this address");
    expect(broken.lamports).toBe("12400000000");
  });
});
