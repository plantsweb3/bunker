/** Read-only summary of what a wallet's own signature, or an existing token
 * approval, can move. Public chain data only; no prices are inferred. */
export const TOKEN_2022_PROGRAM_ID =
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export type ParsedTokenInfo = {
  mint: string;
  state?: string;
  tokenAmount: { amount: string; decimals: number };
  delegate?: string;
  delegatedAmount?: { amount: string };
};
export type TokenHolding = {
  account: string;
  mint: string;
  amount: bigint;
  /** Unknown when the wallet was too large to read in full. */
  decimals: number | null;
  frozen: boolean;
  program: "classic" | "token-2022";
  delegate: string | null;
  delegatedAmount: bigint;
  /** A Token-2022 "permanent delegate": an address fixed by the token's
   * issuer that can move or burn this balance without the wallet signing. */
  issuer: string | null;
};
export type Exposure = {
  lamports: bigint;
  /** Non-empty, unfrozen token accounts: one wallet signature can move these. */
  movable: TokenHolding[];
  /** Accounts another address may already move without a new signature. */
  approvals: TokenHolding[];
  /** Balances the token's own issuer can move without any signature here. */
  issuerMovable: TokenHolding[];
  /** Movable holdings Bunker's program supports (classic SPL only). */
  supported: TokenHolding[];
  unsupported: TokenHolding[];
  frozen: number;
  emptyAccounts: number;
};
function holding(
  account: string,
  info: ParsedTokenInfo,
  program: TokenHolding["program"],
): TokenHolding | null {
  const decimals = info?.tokenAmount?.decimals;
  const unknownDecimals = (info as { rawDecimals?: boolean })?.rawDecimals === true;
  if (
    typeof info?.mint !== "string" ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 18 ||
    !/^[0-9]+$/.test(info.tokenAmount.amount)
  )
    return null;
  const delegated = info.delegatedAmount?.amount;
  return {
    account,
    mint: info.mint,
    amount: BigInt(info.tokenAmount.amount),
    decimals: unknownDecimals ? null : decimals,
    frozen: info.state === "frozen",
    program,
    delegate: typeof info.delegate === "string" ? info.delegate : null,
    delegatedAmount:
      typeof delegated === "string" && /^[0-9]+$/.test(delegated)
        ? BigInt(delegated)
        : 0n,
    issuer: null,
  };
}
/** How many leading bytes of a token account `rawTokenInfo` reads. Both token
 * programs share this layout: mint, owner, amount, delegate, state, native,
 * delegated amount. */
export const RAW_TOKEN_BYTES = 129;
/** Reads a token account from its first bytes, for wallets with too many
 * accounts to fetch fully parsed. The token's decimals are not in the account,
 * so amounts read this way cannot be shown in the token's own units. */
export function rawTokenInfo(
  data: Uint8Array,
  base58: (bytes: Uint8Array) => string,
): (ParsedTokenInfo & { rawDecimals: true }) | null {
  if (data.length < RAW_TOKEN_BYTES || data[108] === 0 || data[108] > 2) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const delegated = view.getUint32(72, true) === 1;
  return {
    mint: base58(data.subarray(0, 32)),
    state: data[108] === 2 ? "frozen" : "initialized",
    tokenAmount: { amount: view.getBigUint64(64, true).toString(), decimals: 0 },
    ...(delegated
      ? {
          delegate: base58(data.subarray(76, 108)),
          delegatedAmount: { amount: view.getBigUint64(121, true).toString() },
        }
      : {}),
    rawDecimals: true,
  };
}
/** The permanent delegate of a parsed Token-2022 mint, if it has one. */
export function permanentDelegate(mintInfo: unknown): string | null {
  const extensions = (mintInfo as { extensions?: unknown })?.extensions;
  if (!Array.isArray(extensions)) return null;
  for (const e of extensions) {
    const delegate = e?.extension === "permanentDelegate" ? e?.state?.delegate : null;
    if (typeof delegate === "string" && delegate.length >= 32) return delegate;
  }
  return null;
}
export function summarizeExposure(
  lamports: number,
  classic: { account: string; info: ParsedTokenInfo }[],
  token2022: { account: string; info: ParsedTokenInfo }[],
  /** Token-2022 mint address to its permanent delegate, where one exists. */
  issuers: ReadonlyMap<string, string> = new Map(),
): Exposure {
  if (!Number.isSafeInteger(lamports) || lamports < 0)
    throw new Error("SOL balance is outside the safe integer range");
  const all = [
    ...classic.map((t) => holding(t.account, t.info, "classic")),
    ...token2022.map((t) => holding(t.account, t.info, "token-2022")),
  ]
    .filter((t): t is TokenHolding => t !== null)
    .map((t) => (t.program === "token-2022" ? { ...t, issuer: issuers.get(t.mint) ?? null } : t));
  const held = all.filter((t) => t.amount > 0n);
  const movable = held
    .filter((t) => !t.frozen)
    .sort((a, b) => (a.mint < b.mint ? -1 : a.mint > b.mint ? 1 : 0));
  return {
    lamports: BigInt(lamports),
    movable,
    // A frozen account cannot be moved by its delegate either. An approval on
    // an account that is empty today still applies to whatever arrives later.
    approvals: all.filter((t) => !t.frozen && t.delegate && t.delegatedAmount > 0n),
    // The issuer's power does not depend on the account being unfrozen.
    issuerMovable: held.filter((t) => t.issuer),
    supported: movable.filter((t) => t.program === "classic"),
    unsupported: movable.filter((t) => t.program === "token-2022"),
    frozen: held.length - movable.length,
    emptyAccounts: all.length - held.length,
  };
}
