/** Address poisoning: someone makes an address that starts and ends like one
 * a wallet has paid, then sends the wallet a tiny amount from it, so the fake
 * sits in the wallet's history next to the real one. The next time the owner
 * copies "that address" from their history, they pay the thief.
 *
 * This file finds such senders in a wallet's recent transactions. It reads
 * only balance changes, so it needs no list of programs, and it has no
 * imports, so the server route, the tests and the extension can share it. */

/** One transaction, reduced to what moved and who signed. */
export type Movement = {
  signature: string;
  /** Seconds since 1970, or null when the network did not record one. */
  time: number | null;
  /** Account addresses, in the transaction's order. */
  keys: string[];
  /** How many of the first keys signed. */
  signers: number;
  sol: { pre: bigint; post: bigint }[];
  /** Token balances by owner and mint, before and after. */
  tokens: { owner: string; mint: string; pre: bigint; post: bigint }[];
};
export type Lookalike = {
  /** The address that sent the wallet something. */
  sender: string;
  /** The address this wallet really paid, which the sender imitates. */
  imitates: string;
  /** How many characters match at the start and at the end. */
  start: number;
  end: number;
  signature: string;
  time: number | null;
  /** What arrived: lamports of SOL, or base units of one mint. */
  received: { lamports: bigint } | { mint: string; amount: bigint };
};

/** `getTransaction` with "json" encoding, as far as this file reads it. */
export type JsonTransaction = {
  blockTime?: number | null;
  transaction: { message: { accountKeys: string[]; header: { numRequiredSignatures: number } } };
  meta: {
    preBalances: number[];
    postBalances: number[];
    loadedAddresses?: { writable: string[]; readonly: string[] };
    preTokenBalances?: TokenBalance[];
    postTokenBalances?: TokenBalance[];
  } | null;
};
type TokenBalance = { owner?: string; mint: string; uiTokenAmount: { amount: string } };
/** One transaction as a movement, or null if its answer cannot be accounted for. */
export function movementOf(signature: string, tx: JsonTransaction | null): Movement | null {
  const meta = tx?.meta;
  const message = tx?.transaction?.message;
  if (!meta || !message || !Array.isArray(message.accountKeys)) return null;
  // Accounts found through lookup tables follow the stated ones, in this order.
  const keys = [...message.accountKeys, ...(meta.loadedAddresses?.writable ?? []), ...(meta.loadedAddresses?.readonly ?? [])];
  const whole = (n: unknown) => Number.isSafeInteger(n) && (n as number) >= 0;
  if (meta.preBalances?.length !== keys.length || meta.postBalances?.length !== keys.length) return null;
  if (![...meta.preBalances, ...meta.postBalances].every(whole) || !whole(message.header?.numRequiredSignatures)) return null;
  const tokens = new Map<string, Movement["tokens"][number]>();
  const add = (side: "pre" | "post", list: TokenBalance[] | undefined) => {
    for (const b of list ?? []) {
      if (!b.owner || !/^[0-9]+$/.test(b.uiTokenAmount?.amount ?? "")) continue;
      const id = `${b.owner}:${b.mint}`;
      const row = tokens.get(id) ?? { owner: b.owner, mint: b.mint, pre: 0n, post: 0n };
      row[side] += BigInt(b.uiTokenAmount.amount);
      tokens.set(id, row);
    }
  };
  add("pre", meta.preTokenBalances);
  add("post", meta.postTokenBalances);
  return {
    signature,
    time: typeof tx.blockTime === "number" ? tx.blockTime : null,
    keys,
    signers: message.header.numRequiredSignatures,
    sol: keys.map((_, i) => ({ pre: BigInt(meta.preBalances[i]), post: BigInt(meta.postBalances[i]) })),
    tokens: [...tokens.values()],
  };
}

const shared = (a: string, b: string) => {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
};
/** Two different addresses that look alike at a glance: at least seven
 * characters match between the start and the end, and at least two at each.
 * Wallets show the start and the end and hide the middle. Two unrelated
 * addresses match this by chance about once in two trillion tries. */
export function looksLike(a: string, b: string): { start: number; end: number } | null {
  if (a === b) return null;
  const start = shared(a, b);
  const end = shared([...a].reverse().join(""), [...b].reverse().join(""));
  return start >= 2 && end >= 2 && start + end >= 7 ? { start, end } : null;
}

/** Senders in `history` that imitate an address `wallet` has paid. */
export function findLookalikes(wallet: string, history: Movement[]): Lookalike[] {
  // Everyone the wallet has paid: SOL or tokens that left it, in a
  // transaction it signed, and arrived with someone else.
  const paid = new Set<string>();
  for (const m of history) {
    const at = m.keys.indexOf(wallet);
    if (at < 0 || at >= m.signers) continue;
    if (m.sol[at] && m.sol[at].post < m.sol[at].pre)
      m.keys.forEach((k, i) => i !== at && m.sol[i] && m.sol[i].post > m.sol[i].pre && paid.add(k));
    for (const out of m.tokens.filter((t) => t.owner === wallet && t.post < t.pre))
      for (const t of m.tokens) if (t.mint === out.mint && t.owner !== wallet && t.post > t.pre) paid.add(t.owner);
  }
  const found: Lookalike[] = [];
  const seen = new Set<string>();
  for (const m of history) {
    const at = m.keys.indexOf(wallet);
    // Something it did not send for itself.
    if (at >= 0 && at < m.signers) continue;
    const arrived: Lookalike["received"][] = [];
    if (at >= 0 && m.sol[at] && m.sol[at].post > m.sol[at].pre) arrived.push({ lamports: m.sol[at].post - m.sol[at].pre });
    for (const t of m.tokens) if (t.owner === wallet && t.post > t.pre) arrived.push({ mint: t.mint, amount: t.post - t.pre });
    if (!arrived.length) continue;
    // Whoever could have sent it: the signers, and anyone whose balance went down.
    const senders = new Set<string>(m.keys.slice(0, m.signers));
    m.keys.forEach((k, i) => m.sol[i] && m.sol[i].post < m.sol[i].pre && senders.add(k));
    for (const t of m.tokens) if (t.post < t.pre) senders.add(t.owner);
    for (const sender of senders) {
      if (sender === wallet || paid.has(sender)) continue;
      for (const real of paid) {
        const match = looksLike(sender, real);
        if (!match || seen.has(`${sender}:${m.signature}`)) continue;
        seen.add(`${sender}:${m.signature}`);
        found.push({ sender, imitates: real, ...match, signature: m.signature, time: m.time, received: arrived[0] });
      }
    }
  }
  return found;
}
