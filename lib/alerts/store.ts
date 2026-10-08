/** Where alert subscriptions and snapshots live. The production store talks to
 * an Upstash-compatible Redis REST endpoint with plain fetch; nothing here is
 * secret: a Telegram chat id, the Bunker addresses it watches, and the public
 * state of each as last reported.
 *
 * Subscriptions change only from the Telegram webhook, which is registered
 * with one connection at a time (scripts/telegram-setup.mjs), so two changes
 * never interleave. Writes are ordered so that a crash part-way leaves only
 * state that /stop, or the watcher itself, removes. */
export interface WatchStore {
  /** Adds a subscription. Returns false if either limit would be exceeded. */
  subscribe(chat: string, vault: string, snapshot: string | null): Promise<boolean>;
  /** Removes every subscription for a chat; returns the vaults it had. */
  unsubscribe(chat: string): Promise<string[]>;
  vaultsOf(chat: string): Promise<string[]>;
  chatsOf(vault: string): Promise<string[]>;
  /** Up to `count` watched vaults, continuing after where the last call stopped. */
  nextVaults(count: number): Promise<string[]>;
  snapshot(vault: string): Promise<string | null>;
  setSnapshot(vault: string, snapshot: string): Promise<void>;
  /** Stops watching a vault nobody is subscribed to. */
  forget(vault: string): Promise<void>;
  /** Takes the watcher lock for `seconds`. False if another pass holds it. */
  lock(seconds: number): Promise<boolean>;
}
export const MAX_VAULTS_PER_CHAT = 5;
export const MAX_WATCHED_VAULTS = 5000;
const K = {
  vaults: "bunker:watch:vaults",
  subs: (vault: string) => `bunker:watch:subs:${vault}`,
  chat: (chat: string) => `bunker:watch:chat:${chat}`,
  snapshot: (vault: string) => `bunker:watch:state:${vault}`,
  turn: "bunker:watch:turn",
  lock: "bunker:watch:lock",
};
/** For tests and local runs. */
export class MemoryStore implements WatchStore {
  private subs = new Map<string, Set<string>>();
  private chats = new Map<string, Set<string>>();
  private snapshots = new Map<string, string>();
  private turn = 0;
  private lockedUntil = 0;
  async subscribe(chat: string, vault: string, cursor: string | null) {
    const mine = this.chats.get(chat) ?? new Set<string>();
    if (!mine.has(vault) && mine.size >= MAX_VAULTS_PER_CHAT) return false;
    if (!this.subs.has(vault) && this.subs.size >= MAX_WATCHED_VAULTS) return false;
    if (!this.subs.has(vault) && cursor) this.snapshots.set(vault, cursor);
    this.chats.set(chat, mine.add(vault));
    this.subs.set(vault, (this.subs.get(vault) ?? new Set<string>()).add(chat));
    return true;
  }
  async unsubscribe(chat: string) {
    const mine = [...(this.chats.get(chat) ?? [])];
    for (const vault of mine) {
      const s = this.subs.get(vault);
      s?.delete(chat);
      if (s && s.size === 0) {
        this.subs.delete(vault);
        this.snapshots.delete(vault);
      }
    }
    this.chats.delete(chat);
    return mine;
  }
  async vaultsOf(chat: string) {
    return [...(this.chats.get(chat) ?? [])];
  }
  async chatsOf(vault: string) {
    return [...(this.subs.get(vault) ?? [])];
  }
  async nextVaults(count: number) {
    const all = [...this.subs.keys()].sort();
    if (all.length === 0) return [];
    const out: string[] = [];
    for (let i = 0; i < Math.min(count, all.length); i++)
      out.push(all[(this.turn + i) % all.length]);
    this.turn = (this.turn + out.length) % all.length;
    return out;
  }
  async snapshot(vault: string) {
    return this.snapshots.get(vault) ?? null;
  }
  async setSnapshot(vault: string, snapshot: string) {
    this.snapshots.set(vault, snapshot);
  }
  async forget(vault: string) {
    if (this.subs.get(vault)?.size) return;
    this.subs.delete(vault);
    this.snapshots.delete(vault);
  }
  async lock(seconds: number) {
    if (Date.now() < this.lockedUntil) return false;
    this.lockedUntil = Date.now() + seconds * 1000;
    return true;
  }
  /** For tests: lets the next pass start at once. */
  unlock() {
    this.lockedUntil = 0;
  }
}
/** Upstash Redis over REST: one POST per command, `["CMD", ...args]`. */
export class RestStore implements WatchStore {
  constructor(
    private url: string,
    private token: string,
  ) {
    if (new URL(url).protocol !== "https:") throw new Error("Alert store must use HTTPS");
  }
  private async run<T>(...command: (string | number)[]): Promise<T> {
    const r = await fetch(this.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(8000),
      redirect: "error",
    });
    const body = (await r.json()) as { result?: T; error?: string };
    if (!r.ok || body.error) throw new Error("Alert store unavailable");
    return body.result as T;
  }
  async subscribe(chat: string, vault: string, cursor: string | null) {
    const [mine, watched] = await Promise.all([
      this.run<string[]>("SMEMBERS", K.chat(chat)),
      this.run<number>("SISMEMBER", K.vaults, vault),
    ]);
    if (!mine.includes(vault) && mine.length >= MAX_VAULTS_PER_CHAT) return false;
    if (!watched) {
      if ((await this.run<number>("SCARD", K.vaults)) >= MAX_WATCHED_VAULTS) return false;
      if (cursor) await this.run("SET", K.snapshot(vault), cursor);
    }
    // The chat's own list first: whatever happens next, /stop can undo it.
    await this.run("SADD", K.chat(chat), vault);
    await this.run("SADD", K.subs(vault), chat);
    await this.run("SADD", K.vaults, vault);
    return true;
  }
  async unsubscribe(chat: string) {
    const mine = await this.run<string[]>("SMEMBERS", K.chat(chat));
    for (const vault of mine) {
      await this.run("SREM", K.subs(vault), chat);
      if ((await this.run<number>("SCARD", K.subs(vault))) === 0) {
        await this.run("SREM", K.vaults, vault);
        await this.run("DEL", K.snapshot(vault));
      }
    }
    await this.run("DEL", K.chat(chat));
    return mine;
  }
  vaultsOf(chat: string) {
    return this.run<string[]>("SMEMBERS", K.chat(chat));
  }
  chatsOf(vault: string) {
    return this.run<string[]>("SMEMBERS", K.subs(vault));
  }
  async nextVaults(count: number) {
    const all = (await this.run<string[]>("SMEMBERS", K.vaults)).sort();
    if (all.length === 0) return [];
    const take = Math.min(count, all.length);
    const end = await this.run<number>("INCRBY", K.turn, take);
    const start = (((end - take) % all.length) + all.length) % all.length;
    return Array.from({ length: take }, (_, i) => all[(start + i) % all.length]);
  }
  snapshot(vault: string) {
    return this.run<string | null>("GET", K.snapshot(vault));
  }
  async setSnapshot(vault: string, snapshot: string) {
    await this.run("SET", K.snapshot(vault), snapshot);
  }
  async forget(vault: string) {
    if ((await this.run<number>("SCARD", K.subs(vault))) > 0) return;
    await this.run("SREM", K.vaults, vault);
    await this.run("DEL", K.snapshot(vault));
  }
  async lock(seconds: number) {
    return (await this.run<string | null>("SET", K.lock, "1", "NX", "EX", seconds)) === "OK";
  }
}
