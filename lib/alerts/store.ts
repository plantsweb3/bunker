/** Where alert subscriptions and cursors live. The production store talks to
 * an Upstash-compatible Redis REST endpoint with plain fetch; nothing here is
 * secret: a Telegram chat id, the Bunker addresses it watches, and the last
 * transaction already reported for each. */
export interface WatchStore {
  /** Adds a subscription. Returns false if either limit would be exceeded. */
  subscribe(chat: string, vault: string, cursor: string | null): Promise<boolean>;
  /** Removes every subscription for a chat; returns the vaults it had. */
  unsubscribe(chat: string): Promise<string[]>;
  vaultsOf(chat: string): Promise<string[]>;
  chatsOf(vault: string): Promise<string[]>;
  /** Up to `count` watched vaults, continuing after where the last call stopped. */
  nextVaults(count: number): Promise<string[]>;
  cursor(vault: string): Promise<string | null>;
  setCursor(vault: string, signature: string): Promise<void>;
}
export const MAX_VAULTS_PER_CHAT = 5;
export const MAX_WATCHED_VAULTS = 5000;
const K = {
  vaults: "bunker:watch:vaults",
  subs: (vault: string) => `bunker:watch:subs:${vault}`,
  chat: (chat: string) => `bunker:watch:chat:${chat}`,
  cursor: (vault: string) => `bunker:watch:cursor:${vault}`,
  turn: "bunker:watch:turn",
};
/** For tests and local runs. */
export class MemoryStore implements WatchStore {
  private subs = new Map<string, Set<string>>();
  private chats = new Map<string, Set<string>>();
  private cursors = new Map<string, string>();
  private turn = 0;
  async subscribe(chat: string, vault: string, cursor: string | null) {
    const mine = this.chats.get(chat) ?? new Set<string>();
    if (!mine.has(vault) && mine.size >= MAX_VAULTS_PER_CHAT) return false;
    if (!this.subs.has(vault) && this.subs.size >= MAX_WATCHED_VAULTS) return false;
    if (!this.subs.has(vault) && cursor) this.cursors.set(vault, cursor);
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
        this.cursors.delete(vault);
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
  async cursor(vault: string) {
    return this.cursors.get(vault) ?? null;
  }
  async setCursor(vault: string, signature: string) {
    this.cursors.set(vault, signature);
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
      if (cursor) await this.run("SET", K.cursor(vault), cursor);
    }
    await this.run("SADD", K.vaults, vault);
    await this.run("SADD", K.subs(vault), chat);
    await this.run("SADD", K.chat(chat), vault);
    return true;
  }
  async unsubscribe(chat: string) {
    const mine = await this.run<string[]>("SMEMBERS", K.chat(chat));
    for (const vault of mine) {
      await this.run("SREM", K.subs(vault), chat);
      if ((await this.run<number>("SCARD", K.subs(vault))) === 0) {
        await this.run("SREM", K.vaults, vault);
        await this.run("DEL", K.cursor(vault));
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
  cursor(vault: string) {
    return this.run<string | null>("GET", K.cursor(vault));
  }
  async setCursor(vault: string, signature: string) {
    await this.run("SET", K.cursor(vault), signature);
  }
}
