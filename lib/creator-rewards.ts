/** Creator rewards a wallet has earned on pump.fun and not yet claimed.
 *
 * They sit in two places until the creator claims them, and both are
 * addresses anyone can derive from the creator's wallet and read:
 *  - while a coin trades on its bonding curve, a plain account that holds SOL;
 *  - after it moves to the exchange, a wrapped-SOL token account.
 * Claiming moves both into the creator's wallet, so wallet plus unclaimed is
 * the same total before and after a claim.
 *
 * This file only reads what those accounts hold. It has no imports, so the
 * page can use it in the browser. Anything that does not look exactly like
 * what is expected counts as unknown, never as zero and never as a guess. */
export const WRAPPED_SOL = "So11111111111111111111111111111111111111112";
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const SYSTEM_PROGRAM = "11111111111111111111111111111111";
export type RewardAccounts = {
  /** The plain account for rewards earned on the bonding curve. */
  curveVault: string;
  /** The wrapped-SOL account for rewards earned on the exchange… */
  exchangeVault: string;
  /** …and the address that must own it. */
  exchangeAuthority: string;
};
/** One account as `getMultipleAccounts` returns it with base64 encoding. */
export type RawAccount = { lamports: number; owner: string; data: [string, string] } | null;

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  for (; n > 0n; n /= 58n) out = B58[Number(n % 58n)] + out;
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}
function decode(data: [string, string]): Uint8Array | null {
  if (data[1] !== "base64") return null;
  try {
    return Uint8Array.from(atob(data[0]), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}
/** Lamports of rewards in the bonding-curve vault: what it holds above the
 * minimum every account must keep. An account that does not exist holds none. */
export function curveRewards(account: RawAccount, rentMinimum: number): number | null {
  if (account === null) return 0;
  if (account.owner !== SYSTEM_PROGRAM || !Number.isSafeInteger(account.lamports)) return null;
  const bytes = decode(account.data);
  if (!bytes || bytes.length !== 0) return null;
  return Math.max(0, account.lamports - rentMinimum);
}
/** Lamports of rewards in the exchange vault: the wrapped SOL it holds. */
export function exchangeRewards(account: RawAccount, accounts: RewardAccounts): number | null {
  if (account === null) return 0;
  if (account.owner !== TOKEN_PROGRAM) return null;
  const bytes = decode(account.data);
  // A classic token account: mint, owner, amount, then fields not used here.
  if (!bytes || bytes.length !== 165) return null;
  if (base58(bytes.subarray(0, 32)) !== WRAPPED_SOL) return null;
  if (base58(bytes.subarray(32, 64)) !== accounts.exchangeAuthority) return null;
  let amount = 0n;
  for (let i = 7; i >= 0; i--) amount = (amount << 8n) | BigInt(bytes[64 + i]);
  return amount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amount) : null;
}
