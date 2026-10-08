import { describe, it, expect } from "vitest";
import { Connection, PublicKey } from "@solana/web3.js";
import { alertsFromEnv, sameSecret } from "../lib/alerts/config";
import { handleUpdate } from "../lib/alerts/commands";
import { eventText, FOOTER } from "../lib/alerts/messages";
import { MAX_CHATS_PER_VAULT, MAX_VAULTS_PER_CHAT, MemoryStore } from "../lib/alerts/store";
import { diff, runWatch, Snapshot, WatchEvent } from "../lib/alerts/watch";
import { configFromEnv } from "../lib/bunker-config";
import { vaultAddress, VAULT_SIZE } from "../sdk/v3/protocol";
const program = new PublicKey(new Uint8Array(32).fill(11));
const id = (n: number) => new Uint8Array(32).fill(n);
const vault = vaultAddress(program, id(7));
const payer = new PublicKey(id(5));
const CLOCK = "SysvarC1ock11111111111111111111111111111111";
const NOW = 1_800_000_000n;
type Record = { amount: bigint; opensAt: bigint; deadline: bigint; digest: number };
type Sim = { epoch: bigint; opIndex: bigint; lamports: number; pending: Record | null; owner: PublicKey };
function vaultData(vaultId: Uint8Array, v: Sim) {
  const d = new Uint8Array(VAULT_SIZE);
  const view = new DataView(d.buffer);
  d.set(new TextEncoder().encode("BUNKER03"));
  d.set(vaultId, 8);
  d.set(id(2), 40);
  d.set(id(3), 72);
  view.setBigUint64(104, v.opIndex, true);
  view.setBigUint64(112, v.epoch, true);
  d.set(id(4), 120);
  if (v.pending) {
    d[156] = 1;
    d.set(id(6), 190);
    view.setBigUint64(222, v.pending.amount, true);
    view.setBigInt64(230, v.pending.opensAt, true);
    view.setBigInt64(238, v.pending.deadline, true);
    view.setBigUint64(246, v.epoch, true);
    d.set(id(v.pending.digest), 254);
  }
  d[286] = 255;
  return d;
}
/** A stand-in chain that serves vault accounts and the clock, and nothing
 * else: the watcher must not need any transaction history. */
function chain(vaults = [id(7)]) {
  const state = new Map<string, { vaultId: Uint8Array; v: Sim }>(
    vaults.map((v) => [
      vaultAddress(program, v).toBase58(),
      { vaultId: v, v: { epoch: 0n, opIndex: 0n, lamports: 9_000_000, pending: null, owner: program } },
    ]),
  );
  const clock = new Uint8Array(40);
  new DataView(clock.buffer).setBigInt64(32, NOW, true);
  const account = (key: PublicKey) => {
    const found = state.get(key.toBase58());
    return found
      ? { data: vaultData(found.vaultId, found.v), owner: found.v.owner, lamports: found.v.lamports }
      : null;
  };
  return {
    of: (key: PublicKey = vault) => state.get(key.toBase58())!.v,
    connection: {
      getAccountInfo: async (key: PublicKey) =>
        key.toBase58() === CLOCK ? { data: clock, owner: PublicKey.default, lamports: 1 } : account(key),
      getMultipleAccountsInfo: async (keys: PublicKey[]) => keys.map(account),
      getMinimumBalanceForRentExemption: async () => 2_000_000,
    } as unknown as Connection,
  };
}
const watch = (store: MemoryStore, c: ReturnType<typeof chain>, sent: [string, string][], fail?: string) => {
  store.unlock();
  return runWatch({
    store,
    connection: c.connection,
    program,
    send: async (chat, text) => {
      if (chat === fail) throw new Error("blocked");
      sent.push([chat, text]);
    },
    link: (v) => `https://explorer.example/${v}`,
    log: () => undefined,
  });
};
const record = (digest: number, over: Partial<Record> = {}): Record => ({
  amount: 1_250_000_000n,
  opensAt: NOW + 86_400n,
  deadline: NOW + 691_200n,
  digest,
  ...over,
});
describe("Alert watcher", () => {
  it("starts from now and reports each change once, to every subscriber", async () => {
    const c = chain();
    const store = new MemoryStore();
    await store.subscribe("100", vault.toBase58(), null);
    await store.subscribe("200", vault.toBase58(), null);
    const sent: [string, string][] = [];
    expect(await watch(store, c, sent)).toMatchObject({ vaults: 1, events: 0, messages: 0, errors: 0 });
    c.of().lamports += 1_500_000;
    expect(await watch(store, c, sent)).toMatchObject({ events: 1, messages: 2 });
    expect(sent.map(([chat]) => chat)).toEqual(["100", "200"]);
    expect(sent[0][1]).toContain("deposit received");
    expect(sent[0][1]).toContain("+0.0015 SOL");
    Object.assign(c.of(), { opIndex: 1n, pending: record(9) });
    expect(await watch(store, c, sent)).toMatchObject({ events: 1, messages: 2, errors: 0 });
    expect(sent[2][1]).toContain("ANNOUNCED");
    expect(sent[2][1]).toContain("1.25 SOL to " + new PublicKey(id(6)).toBase58());
    expect(sent[2][1]).toContain("It can leave in 1d 0h");
    expect(sent[2][1]).toContain(`https://explorer.example/${vault.toBase58()}`);
    // Nothing new: nothing sent.
    expect(await watch(store, c, sent)).toMatchObject({ events: 0, messages: 0 });
    expect(sent).toHaveLength(4);
  });
  it("needs no transaction history, so traffic can neither hide nor fake an alert", async () => {
    // The stand-in chain has no getSignaturesForAddress or getTransaction at
    // all. However many transactions mention the vault, and whatever they
    // contain, the watcher sees only what the vault account became.
    const c = chain();
    const store = new MemoryStore();
    await store.subscribe("100", vault.toBase58(), null);
    const sent: [string, string][] = [];
    await watch(store, c, sent);
    // Unchanged account: no alert, whatever was sent at it.
    expect(await watch(store, c, sent)).toMatchObject({ events: 0, errors: 0 });
    // Changed account: alerted, however the change was made.
    c.of().epoch = 1n;
    expect(await watch(store, c, sent)).toMatchObject({ events: 1, errors: 0 });
    expect(sent[0][1]).toContain("NEW KEYS were installed");
  });
  it("survives an unreachable chat without repeating or holding back", async () => {
    const c = chain();
    const store = new MemoryStore();
    await store.subscribe("100", vault.toBase58(), null);
    await store.subscribe("blocked", vault.toBase58(), null);
    const sent: [string, string][] = [];
    await watch(store, c, sent, "blocked");
    c.of().epoch = 1n;
    expect(await watch(store, c, sent, "blocked")).toMatchObject({ events: 1, messages: 1, errors: 1 });
    expect((await watch(store, c, sent, "blocked")).messages).toBe(0);
  });
  it("reports an account that stopped being a Bunker as an error, not an event", async () => {
    const c = chain();
    const store = new MemoryStore();
    await store.subscribe("100", vault.toBase58(), null);
    const sent: [string, string][] = [];
    await watch(store, c, sent);
    c.of().owner = payer;
    expect(await watch(store, c, sent)).toMatchObject({ events: 0, errors: 1 });
    expect(sent).toEqual([]);
  });
  it("runs one pass at a time and drops a vault nobody is subscribed to", async () => {
    const c = chain();
    const store = new MemoryStore();
    await store.subscribe("100", vault.toBase58(), null);
    const sent: [string, string][] = [];
    await watch(store, c, sent);
    const overlapping = await runWatch({ store, connection: c.connection, program, send: async () => undefined, link: () => null });
    expect(overlapping.skipped).toBe("busy");
    // A subscription removed part-way: the vault is still listed, with no chats.
    (store as unknown as { subs: Map<string, Set<string>> }).subs.get(vault.toBase58())!.clear();
    c.of().epoch = 1n;
    expect(await watch(store, c, sent)).toMatchObject({ events: 0, messages: 0 });
    expect(await store.nextVaults(5)).toEqual([]);
  });
  it("a pass that runs out of time leaves the rest first in line", async () => {
    const many = Array.from({ length: 250 }, (_, i) => new Uint8Array(32).fill(2).map((b, k) => (k === 0 ? i : b)));
    const c = chain(many);
    const store = new MemoryStore();
    for (let i = 0; i < many.length; i += 5)
      for (const v of many.slice(i, i + 5)) await store.subscribe(`c${i}`, vaultAddress(program, v).toBase58(), null);
    // No time at all: nothing is taken, so nothing is skipped.
    store.unlock();
    const none = await runWatch({ store, connection: c.connection, program, send: async () => undefined, link: () => null, budgetMs: -1, log: () => undefined });
    expect(none.vaults).toBe(0);
    // A pass limited to one batch, then full passes: every vault is reached, none twice in a pass.
    store.unlock();
    const first = await runWatch({ store, connection: c.connection, program, send: async () => undefined, link: () => null, maxVaults: 100, log: () => undefined });
    expect(first.vaults).toBe(100);
    expect(await watch(store, c, [])).toMatchObject({ vaults: 250, errors: 0 });
    // Every vault now has a snapshot.
    for (const v of many) expect(await store.snapshot(vaultAddress(program, v).toBase58())).not.toBeNull();
  });
  it("takes vaults in turn within its per-pass limit, in batches", async () => {
    const ids = [1, 2, 3, 4, 5].map(id);
    const store = new MemoryStore();
    for (const v of ids) await store.subscribe("100", vaultAddress(program, v).toBase58(), null);
    const first = await store.nextVaults(3);
    const second = await store.nextVaults(3);
    expect(new Set([...first, ...second.slice(0, 2)]).size).toBe(5);
    expect(second[2]).toBe(first[0]);
    expect(await new MemoryStore().nextVaults(3)).toEqual([]);
    // More vaults than one account batch holds are all read in a single pass.
    const many = Array.from({ length: 130 }, (_, i) => new Uint8Array(32).fill(1).map((b, k) => (k === 0 ? i : b)));
    const c = chain(many);
    const big = new MemoryStore();
    for (let i = 0; i < many.length; i += 5)
      for (const v of many.slice(i, i + 5)) await big.subscribe(`c${i}`, vaultAddress(program, v).toBase58(), null);
    expect(await watch(big, c, [])).toMatchObject({ vaults: 130, errors: 0 });
  });
});
describe("Reading changes from two snapshots", () => {
  const snap = (over: Partial<Snapshot> = {}): Snapshot => ({ v: 1, epoch: "0", opIndex: "0", lamports: "9000000", pending: null, ...over });
  const p = (digest: string, deadline = NOW + 100n) => ({
    kind: 0 as const,
    mint: PublicKey.default.toBase58(),
    destination: payer.toBase58(),
    amount: "500",
    opensAt: NOW.toString(),
    deadline: deadline.toString(),
    digest,
  });
  const kinds = (a: Snapshot, b: Snapshot, now = NOW) => diff(a, b, now).map((e) => e.kind);
  it("names every transition", () => {
    expect(kinds(snap(), snap())).toEqual([]);
    expect(kinds(snap(), snap({ opIndex: "1", pending: p("aa") }))).toEqual(["announced"]);
    // No waiting period: announced and gone between two passes.
    const instant = diff(snap(), snap({ opIndex: "1", lamports: "8000000" }), NOW);
    expect(instant).toEqual([{ kind: "left", count: 1, record: null, lamports: 1_000_000n }]);
    expect(kinds(snap(), snap({ opIndex: "3" }))).toEqual(["left"]);
    // Released inside its window, and the ambiguous case after the deadline.
    expect(kinds(snap({ opIndex: "1", pending: p("aa") }), snap({ opIndex: "1" }))).toEqual(["left"]);
    expect(kinds(snap({ opIndex: "1", pending: p("aa") }), snap({ opIndex: "1" }), NOW + 101n)).toEqual(["ended"]);
    // One record replaced by another between passes.
    expect(kinds(snap({ opIndex: "1", pending: p("aa") }), snap({ opIndex: "2", pending: p("bb") }))).toEqual(["left", "announced"]);
    // Recovery, with and without a withdrawal to cancel, and with activity after it.
    expect(diff(snap({ opIndex: "4", pending: p("aa") }), snap({ epoch: "1" }), NOW)).toEqual([
      { kind: "recovered", cancelled: p("aa"), unresolved: null },
    ]);
    expect(kinds(snap(), snap({ epoch: "1", opIndex: "1", pending: p("cc") }))).toEqual(["recovered", "announced"]);
    expect(kinds(snap(), snap({ epoch: "2", opIndex: "2" }))).toEqual(["recovered", "left"]);
  });
  it("does not call a withdrawal cancelled when the balance says it left", () => {
    const waiting = snap({ opIndex: "1", lamports: "9000000", pending: p("aa") }); // 500 lamports to go
    // Released, then the owner recovered, all between two passes.
    expect(diff(waiting, snap({ epoch: "1", lamports: "8999500" }), NOW)).toEqual([
      { kind: "left", count: 1, record: p("aa"), lamports: 0n },
      { kind: "recovered", cancelled: null, unresolved: null },
    ]);
    // A token record cannot be settled from the SOL balance: say so.
    const token = { ...p("aa"), kind: 1 as const };
    expect(diff(snap({ opIndex: "1", pending: token }), snap({ epoch: "1" }), NOW)).toEqual([
      { kind: "recovered", cancelled: null, unresolved: token },
    ]);
  });
  it("reports money that left under the old keys before a recovery", () => {
    // No waiting period: announced and sent, then recovered, between two passes.
    expect(diff(snap(), snap({ epoch: "1", lamports: "2000000" }), NOW)).toEqual([
      { kind: "recovered", cancelled: null, unresolved: null },
      { kind: "fell", lamports: 7_000_000n },
    ]);
  });
  it("attributes what left to the record it knows and only the rest to others", () => {
    // A waiting 500 was released and a further instant withdrawal took 700.
    const events = diff(snap({ opIndex: "1", pending: p("aa") }), snap({ opIndex: "2", lamports: "8998800" }), NOW);
    expect(events).toEqual([
      { kind: "left", count: 1, record: p("aa"), lamports: 0n },
      { kind: "left", count: 1, record: null, lamports: 700n },
    ]);
    // A deposit larger than an instant withdrawal hides the amount, not the event,
    // and the wording does not guess that it was a token.
    const masked = diff(snap(), snap({ opIndex: "1", lamports: "9500000" }), NOW);
    expect(masked).toEqual([{ kind: "left", count: 1, record: null, lamports: 0n }]);
    expect(eventText(vault.toBase58(), masked[0], NOW, null)).not.toMatch(/token/i);
  });
  it("reports SOL arriving, but not dust and not alongside something that matters more", () => {
    expect(diff(snap(), snap({ lamports: "10000000" }), NOW)).toEqual([{ kind: "deposit", lamports: 1_000_000n }]);
    expect(kinds(snap(), snap({ lamports: "9999999" }))).toEqual([]);
    expect(kinds(snap(), snap({ lamports: "9000001" }))).toEqual([]);
    expect(kinds(snap(), snap({ lamports: "99000000", opIndex: "1", pending: p("aa") }))).toEqual(["announced"]);
  });
});
describe("Alert wording", () => {
  const pending = { kind: 1 as const, mint: payer.toBase58(), destination: vault.toBase58(), amount: "42", opensAt: "5", deadline: "9", digest: "aa" };
  const events: WatchEvent[] = [
    { kind: "deposit", lamports: 5n },
    { kind: "announced", pending },
    { kind: "left", count: 1, record: pending, lamports: 0n },
    { kind: "left", count: 2, record: null, lamports: 7n },
    { kind: "left", count: 1, record: null, lamports: 0n },
    { kind: "ended", record: pending },
    { kind: "recovered", cancelled: pending, unresolved: null },
    { kind: "recovered", cancelled: null, unresolved: pending },
    { kind: "recovered", cancelled: null, unresolved: null },
    { kind: "fell", lamports: 9n },
  ];
  it("always ends with the anti-phishing line and tells the user what to do", () => {
    for (const e of events) {
      const text = eventText(vault.toBase58(), e, 0n, null);
      expect(text.endsWith(FOOTER), e.kind).toBe(true);
      expect(text).not.toMatch(/[<>*_`\[\]]/); // nothing that reads as markup
    }
    expect(eventText(vault.toBase58(), events[1], 0n, null)).toContain("bunkermode.io/recovery");
    expect(eventText(vault.toBase58(), events[1], 0n, null)).toContain("42 base units of token");
    expect(eventText(vault.toBase58(), events[3], 0n, null)).toContain("2 withdrawals left");
    expect(eventText(vault.toBase58(), events[6], 0n, null)).toContain("Withdraw everything");
    expect(eventText(vault.toBase58(), events[6], 0n, null)).toContain("was cancelled");
    expect(eventText(vault.toBase58(), events[7], 0n, null)).not.toContain("was cancelled.");
    expect(eventText(vault.toBase58(), events[7], 0n, null)).toContain("either cancelled by this, or released");
  });
});
describe("Bot commands", () => {
  const deps = (store: MemoryStore, c = chain([1, 2, 3, 4, 5, 6, 7].map(id))) => ({
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
    // Watching starts from the state the Bunker is in when it is subscribed.
    expect(JSON.parse((await store.snapshot(vault.toBase58()))!)).toMatchObject({ epoch: "0", lamports: "9000000", pending: null });
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
    // One Bunker cannot collect unlimited watchers, and the reply says which limit it was.
    const crowd = new MemoryStore();
    for (let n = 0; n < MAX_CHATS_PER_VAULT; n++)
      expect(await crowd.subscribe(`chat-${n}`, vault.toBase58(), null)).toBe("ok");
    expect(await crowd.subscribe("one-more", vault.toBase58(), null)).toBe("vault-limit");
    expect(await crowd.subscribe("chat-0", vault.toBase58(), null)).toBe("ok");
    expect((await handleUpdate(say(`/start ${vault.toBase58()}`, { id: 999, type: "private" }), deps(crowd)))?.text).toContain("as many watchers");
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
    const test = { ...full, BUNKER_ENABLE_TEST_CUSTODY: "true", BUNKER_TEST_NETWORK: "localnet", BUNKER_TEST_PROGRAM_ID: "k7FaK87WHGVXzkaoHb7CdVPgkKDQhZ29VLDeBVbDfYn" };
    expect(configFromEnv(test).alertsBot).toBe("BunkerAlertsBot");
    expect(configFromEnv({ ...test, CRON_SECRET: undefined }).alertsBot).toBeNull();
    // Never advertised in a state where the alert service itself would be off.
    for (const weak of [{ CRON_SECRET: "short" }, { TELEGRAM_WEBHOOK_SECRET: "short" }]) {
      expect(alertsFromEnv({ ...test, ...weak })).toBeNull();
      expect(configFromEnv({ ...test, ...weak }).alertsBot).toBeNull();
    }
  });
  it("compares secrets without accepting a prefix or an absent value", () => {
    expect(sameSecret("abc", "abc")).toBe(true);
    for (const given of [null, "", "ab", "abcd", "abd"]) expect(sameSecret(given, "abc")).toBe(false);
  });
});
