/** One row of the bounty vault's public history: what a single transaction
 * did to the vault's SOL balance, worked out from the transaction itself.
 *
 * Nothing here is typed in. The amount is the difference between the vault's
 * balance before and after, in lamports, so it includes the network fee when
 * the vault paid it. A transaction that names the vault and leaves its balance
 * alone is not a row. This file has no imports, so the tests and the server
 * route share it. */
export const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
/** How many transactions one page reads. The same bound /api/rpc keeps. */
export const PAGE = 25;
export const REWARDS_LABEL = "Creator rewards";
/** `getTransaction` with "json" encoding, as far as this file reads it. */
export type ChainTransaction = {
  transaction: { message: { accountKeys: string[] } };
  meta: {
    preBalances: number[];
    postBalances: number[];
    loadedAddresses?: { writable: string[]; readonly: string[] };
  } | null;
};
export type VaultRow = {
  signature: string;
  /** Seconds since 1970, or null when the network did not record a time. */
  time: number | null;
  direction: "IN" | "OUT";
  /** Always positive. The direction says which way. */
  lamports: number;
  /** Where most of it came from or went. Null when only the fee moved. */
  other: string | null;
  label: string | null;
};
export type Labels = Record<string, string>;

/** The checked-in labels, refused whole if any entry is not a transaction
 * signature with a short plain label. */
export function labelsFrom(json: unknown): Labels {
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("Labels must be an object");
  for (const [signature, label] of Object.entries(json)) {
    if (!SIGNATURE.test(signature)) throw new Error(`Not a transaction signature: ${signature}`);
    if (typeof label !== "string" || !/^[A-Za-z0-9 ]{1,40}$/.test(label)) throw new Error(`Not a label: ${signature}`);
  }
  return json as Labels;
}
/** Every lamport, with no rounding: 3854748365 is "3.854748365". */
export function exactSol(lamports: number): string {
  if (!Number.isSafeInteger(lamports) || lamports < 0) throw new Error("Not an amount");
  const whole = Math.floor(lamports / 1e9);
  const rest = String(lamports % 1e9).padStart(9, "0").replace(/0+$/, "");
  return rest ? `${whole}.${rest}` : String(whole);
}
/** The row for one transaction, or null if it did not move the vault's
 * balance. Throws when the answer is not shaped as expected, so that a
 * transaction is never shown with a guessed amount or silently dropped. */
export function rowOf(
  seen: { signature: string; blockTime?: number | null },
  tx: ChainTransaction,
  vault: string,
  /** The vault's own reward accounts: SOL arriving from one is a reward claim. */
  rewards: { curveVault: string; exchangeVault: string } | null,
  labels: Labels,
): VaultRow | null {
  const meta = tx?.meta;
  const stated = tx?.transaction?.message?.accountKeys;
  if (!meta || !Array.isArray(stated)) throw new Error("Transaction has no balances");
  // Accounts found through lookup tables follow the stated ones, in this order.
  const keys = [...stated, ...(meta.loadedAddresses?.writable ?? []), ...(meta.loadedAddresses?.readonly ?? [])];
  const { preBalances: before, postBalances: after } = meta;
  if (!Array.isArray(before) || before.length !== keys.length || !Array.isArray(after) || after.length !== keys.length)
    throw new Error("Balances do not match accounts");
  if (![...before, ...after].every((n) => Number.isSafeInteger(n) && n >= 0)) throw new Error("Not a balance");
  const at = keys.indexOf(vault);
  if (at < 0) throw new Error("Transaction does not name the vault");
  const change = after[at] - before[at];
  if (change === 0) return null;
  const incoming = change > 0;
  // The other side: whoever lost the most when the vault gained, or gained
  // the most when it paid.
  let other: string | null = null;
  let most = 0;
  let fromRewards = false;
  keys.forEach((key, i) => {
    if (i === at) return;
    const moved = incoming ? before[i] - after[i] : after[i] - before[i];
    if (moved > most) [most, other] = [moved, key];
    if (incoming && moved > 0 && rewards && (key === rewards.curveVault || key === rewards.exchangeVault))
      fromRewards = true;
  });
  return {
    signature: seen.signature,
    time: typeof seen.blockTime === "number" ? seen.blockTime : null,
    direction: incoming ? "IN" : "OUT",
    lamports: Math.abs(change),
    other,
    label: labels[seen.signature] ?? (fromRewards ? REWARDS_LABEL : null),
  };
}
