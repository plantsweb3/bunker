import { describe, it, expect } from "vitest";
import { Connection, PublicKey } from "@solana/web3.js";
import { alertsFromEnv, sameSecret } from "../lib/alerts/config";
import { handleUpdate } from "../lib/alerts/commands";
import { alertText, FOOTER } from "../lib/alerts/messages";
import { MAX_VAULTS_PER_CHAT, MemoryStore } from "../lib/alerts/store";
import { runWatch } from "../lib/alerts/watch";
import { configFromEnv } from "../lib/bunker-config";
import type { Activity } from "../sdk/v3/history";
import { vaultAddress, VAULT_SIZE } from "../sdk/v3/protocol";
const program = new PublicKey(new Uint8Array(32).fill(11));
const id = (n: number) => new Uint8Array(32).fill(n);
const vault = vaultAddress(program, id(7));
const payer = new PublicKey(id(5));
const CLOCK = "SysvarC1ock11111111111111111111111111111111";
function vaultData(vaultId: Uint8Array) {
  const d = new Uint8Array(VAULT_SIZE);
  d.set(new TextEncoder().encode("BUNKER03"));
  d.set(vaultId, 8);
  d.set(id(2), 40);
  d.set(id(3), 72);
  d.set(id(4), 120);
  d[286] = 255;
  return d;
}
type Tx = { signature: string; ops: number[]; before: number; after: number; failed?: boolean };
/** A stand-in chain: newest-first signatures per address, as the RPC returns them. */
function chain(history: Tx[], vaults = [id(7)]) {
  const known = new Map(vaults.map((v) => [vaultAddress(program, v).toBase58(), v]));
  const clock = new Uint8Array(40);
  new DataView(clock.buffer).setBigInt64(32, 1_800_000_000n, true);
  return {
    history,
    connection: {
      getAccountInfo: async (key: PublicKey) =>
        key.toBase58() === CLOCK
          ? { data: clock, owner: PublicKey.default, lamports: 1 }
          : known.has(key.toBase58())
            ? { data: vaultData(known.get(key.toBase58())!), owner: program, lamports: 9_000_000 }
            : null,
      getMinimumBalanceForRentExemption: async () => 2_000_000,
      getSignaturesForAddress: async (_: PublicKey, o: { until?: string; limit?: number }) => {
        const stop = o.until ? history.findIndex((t) => t.signature === o.until) : -1;
        return (stop >= 0 ? history.slice(0, stop) : history)
          .slice(0, o.limit ?? 1000)
          .map((t) => ({ signature: t.signature, err: null, blockTime: 1 }));
      },
      getTransaction: async (signature: string) => {
        const t = history.find((x) => x.signature === signature)!;
        return {
          blockTime: 1_800_000_000,
          meta: { err: t.failed ? {} : null, preBalances: [9, t.before, 1], postBalances: [8, t.after, 1] },
          transaction: {
            message: {
              staticAccountKeys: [payer, vault, program],
              compiledInstructions: t.ops.map((op) => ({ programIdIndex: 2, data: new Uint8Array([op]) })),
            },
          },
        };
      },
    } as unknown as Connection,
  };
}
const watch = (store: MemoryStore, c: ReturnType<typeof chain>, sent: [string, string][], fail?: string) =>
  runWatch({
    store,
    connection: c.connection,
    program,
    send: async (chat, text) => {
      if (chat === fail) throw new Error("blocked");
      sent.push([chat, text]);
    },
    link: (s) => `https://explorer.example/${s}`,
  });
describe("Alert watcher", () => {
  it("starts from now, reports new events once, in order, to every subscriber", async () => {
    const c = chain([{ signature: "s1", ops: [0], before: 0, after: 2_000_000 }]);
    const store = new MemoryStore();
    await store.subscribe("100", vault.toBase58(), "s1");
    await store.subscribe("200", vault.toBase58(), "ignored-because-already-watched");
    const sent: [string, string][] = [];
    expect(await watch(store, c, sent)).toMatchObject({ vaults: 1, events: 0, messages: 0 });
    c.history.unshift({ signature: "s2", ops: [], before: 2_000_000, after: 3_500_000 });
    c.history.unshift({ signature: "s3", ops: [2, 3], before: 3_500_000, after: 3_000_000 });
    expect(await watch(store, c, sent)).toMatchObject({ events: 2, messages: 4, errors: 0 });
    expect(sent.map(([chat]) => chat)).toEqual(["100", "200", "100", "200"]);
    expect(sent[0][1]).toContain("deposit received");
    expect(sent[0][1]).toContain("+0.0015 SOL");
    expect(sent[2][1]).toContain("a withdrawal was sent");
    expect(sent[2][1]).toContain("−0.0005 SOL");
    expect(sent[2][1]).toContain("https://explorer.example/s3");
    expect(await store.cursor(vault.toBase58())).toBe("s3");
    // Nothing new: nothing sent.
    expect(await watch(store, c, sent)).toMatchObject({ events: 0, messages: 0 });
    expect(sent).toHaveLength(4);
  });
  it("does not replay history for a vault seen for the first time", async () => {
    const c = chain([{ signature: "old", ops: [5], before: 1, after: 1 }]);
    const store = new MemoryStore();
    await store.subscribe("100", vault.toBase58(), null);
    const sent: [string, string][] = [];
    await watch(store, c, sent);
    expect(sent).toEqual([]);
    expect(await store.cursor(vault.toBase58())).toBe("old");
  });
  it("skips failed transactions and proof uploads, and survives an unreachable chat", async () => {
    const c = chain([{ signature: "s1", ops: [0], before: 0, after: 1 }]);
    const store = new MemoryStore();
    await store.subscribe("100", vault.toBase58(), "s1");
    await store.subscribe("blocked", vault.toBase58(), null);
    c.history.unshift({ signature: "s2", ops: [2], before: 1, after: 1, failed: true });
    c.history.unshift({ signature: "s3", ops: [5], before: 1, after: 1 });
    const sent: [string, string][] = [];
    const result = await watch(store, c, sent, "blocked");
    expect(result).toMatchObject({ events: 1, messages: 1, errors: 1 });
    expect(sent[0][1]).toContain("NEW KEYS were installed");
    // The failed delivery is not retried and does not hold the cursor back.
    expect(await store.cursor(vault.toBase58())).toBe("s3");
    expect((await watch(store, c, sent, "blocked")).messages).toBe(0);
  });
  it("takes vaults in turn within its per-pass limit", async () => {
    const ids = [1, 2, 3, 4, 5].map(id);
    const store = new MemoryStore();
    for (const v of ids) await store.subscribe("100", vaultAddress(program, v).toBase58(), "x");
    const first = await store.nextVaults(3);
    const second = await store.nextVaults(3);
    expect(new Set([...first, ...second.slice(0, 2)]).size).toBe(5);
    expect(second[2]).toBe(first[0]);
    expect(await new MemoryStore().nextVaults(3)).toEqual([]);
  });
});
describe("Alert wording", () => {
  const base: Activity = { signature: "s", time: 1, failed: false, kind: "deposit", sol: 5n, tokens: [] };
  it("says nothing for events that are not worth a message", () => {
    for (const a of [{ ...base, failed: true }, { ...base, kind: "built" as const }, { ...base, kind: "other" as const }])
      expect(alertText(vault.toBase58(), a, null, 0n, null)).toBeNull();
  });
  it("always ends with the anti-phishing line and tells the user what to do", () => {
    for (const kind of ["deposit", "announced", "sent", "released", "cleared", "recovered"] as const) {
      const text = alertText(vault.toBase58(), { ...base, kind }, null, 0n, null)!;
      expect(text.endsWith(FOOTER), kind).toBe(true);
      expect(text).not.toMatch(/[<>*_`\[\]]/); // nothing that reads as markup
    }
    expect(alertText(vault.toBase58(), { ...base, kind: "announced" }, null, 0n, null)).toContain("bunkermode.io/recovery");
    expect(alertText(vault.toBase58(), { ...base, kind: "recovered" }, null, 0n, null)).toContain("Withdraw everything");
  });
});
describe("Bot commands", () => {
  const deps = (store: MemoryStore, c = chain([{ signature: "s1", ops: [0], before: 0, after: 1 }], [1, 2, 3, 4, 5, 6, 7].map(id))) => ({
    store,
    connection: c.connection,
    program,
  });
  const say = (text: unknown, chat: unknown = { id: 100, type: "private" }) =>
    ({ message: { text, chat } }) as never;
  it("subscribes only to a real Bunker, from a private chat", async () => {
    const store = new MemoryStore();
    const ok = await handleUpdate(say(`/start ${vault.toBase58()}`), deps(store));
    expect(ok?.chat).toBe("100");
    expect(ok?.text).toContain("Watching Bunker");
    expect(ok?.text).toContain("Silence is not proof");
    expect(await store.vaultsOf("100")).toEqual([vault.toBase58()]);
    expect(await store.cursor(vault.toBase58())).toBe("s1");
    const notVault = await handleUpdate(say(`/start ${payer.toBase58()}`), deps(store));
    expect(notVault?.text).toContain("not a Bunker");
    for (const bad of ["/start", "/start not-an-address", "/start <b>x</b>", `/start ${"1".repeat(60)}`])
      expect((await handleUpdate(say(bad), deps(store)))?.text).toContain("Open your Bunker");
    expect(await store.vaultsOf("100")).toHaveLength(1);
    // Groups, channels, non-text and malformed updates are ignored entirely.
    for (const update of [
      say(`/start ${vault.toBase58()}`, { id: -5, type: "group" }),
      say(42),
      say("/list", { id: "100", type: "private" }),
      {},
      { message: null },
    ])
      expect(await handleUpdate(update as never, deps(store))).toBeNull();
  });
  it("limits vaults per chat, lists them, and stops everything", async () => {
    const store = new MemoryStore();
    const d = deps(store);
    for (let n = 1; n <= MAX_VAULTS_PER_CHAT; n++)
      expect((await handleUpdate(say(`/start ${vaultAddress(program, id(n)).toBase58()}`), d))?.text).toContain("Watching");
    const over = await handleUpdate(say(`/start ${vaultAddress(program, id(6)).toBase58()}`), d);
    expect(over?.text).toContain(`up to ${MAX_VAULTS_PER_CHAT}`);
    expect((await handleUpdate(say("/list"), d))?.text.split("\n").filter((l) => l.length > 40)).toHaveLength(MAX_VAULTS_PER_CHAT);
    expect((await handleUpdate(say("/stop"), d))?.text).toContain(`${MAX_VAULTS_PER_CHAT} Bunker`);
    expect(await store.vaultsOf("100")).toEqual([]);
    expect(await store.nextVaults(10)).toEqual([]);
    expect((await handleUpdate(say("/stop"), d))?.text).toContain("not watching");
    expect((await handleUpdate(say("hello"), d))?.text).toContain("Commands");
  });
});
describe("Alert configuration", () => {
  const full = {
    TELEGRAM_BOT_TOKEN: "1:abc",
    TELEGRAM_BOT_USERNAME: "BunkerAlertsBot",
    TELEGRAM_WEBHOOK_SECRET: "w".repeat(24),
    CRON_SECRET: "c".repeat(24),
    KV_REST_API_URL: "https://store.example",
    KV_REST_API_TOKEN: "t",
  };
  it("is off unless every piece is present and well formed", () => {
    expect(alertsFromEnv(full)?.botUsername).toBe("BunkerAlertsBot");
    for (const key of Object.keys(full)) expect(alertsFromEnv({ ...full, [key]: undefined }), key).toBeNull();
    expect(alertsFromEnv({ ...full, CRON_SECRET: "short" })).toBeNull();
    expect(alertsFromEnv({ ...full, TELEGRAM_BOT_USERNAME: "bad name" })).toBeNull();
    expect(() => alertsFromEnv({ ...full, KV_REST_API_URL: "http://store.example" })).toThrow("HTTPS");
  });
  it("is never advertised on the read-only public site", () => {
    expect(configFromEnv(full).alertsBot).toBeNull();
    const test = { ...full, BUNKER_ENABLE_TEST_CUSTODY: "true", BUNKER_TEST_NETWORK: "localnet", BUNKER_TEST_PROGRAM_ID: "x" };
    expect(configFromEnv(test).alertsBot).toBe("BunkerAlertsBot");
    expect(configFromEnv({ ...test, CRON_SECRET: undefined }).alertsBot).toBeNull();
  });
  it("compares secrets without accepting a prefix or an absent value", () => {
    expect(sameSecret("abc", "abc")).toBe(true);
    for (const given of [null, "", "ab", "abcd", "abd"]) expect(sameSecret(given, "abc")).toBe(false);
  });
});
