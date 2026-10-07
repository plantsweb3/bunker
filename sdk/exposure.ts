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
  decimals: number;
  frozen: boolean;
  program: "classic" | "token-2022";
  delegate: string | null;
  delegatedAmount: bigint;
};
export type Exposure = {
  lamports: bigint;
  /** Non-empty, unfrozen token accounts: one wallet signature can move these. */
  movable: TokenHolding[];
  /** Accounts another address may already move without a new signature. */
  approvals: TokenHolding[];
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
    decimals,
    frozen: info.state === "frozen",
    program,
    delegate: typeof info.delegate === "string" ? info.delegate : null,
    delegatedAmount:
      typeof delegated === "string" && /^[0-9]+$/.test(delegated)
        ? BigInt(delegated)
        : 0n,
  };
}
export function summarizeExposure(
  lamports: number,
  classic: { account: string; info: ParsedTokenInfo }[],
  token2022: { account: string; info: ParsedTokenInfo }[],
): Exposure {
  if (!Number.isSafeInteger(lamports) || lamports < 0)
    throw new Error("SOL balance is outside the safe integer range");
  const all = [
    ...classic.map((t) => holding(t.account, t.info, "classic")),
    ...token2022.map((t) => holding(t.account, t.info, "token-2022")),
  ].filter((t): t is TokenHolding => t !== null);
  const held = all.filter((t) => t.amount > 0n);
  const movable = held
    .filter((t) => !t.frozen)
    .sort((a, b) => (a.mint < b.mint ? -1 : a.mint > b.mint ? 1 : 0));
  return {
    lamports: BigInt(lamports),
    movable,
    // A frozen account cannot be moved by its delegate either.
    approvals: movable.filter((t) => t.delegate && t.delegatedAmount > 0n),
    supported: movable.filter((t) => t.program === "classic"),
    unsupported: movable.filter((t) => t.program === "token-2022"),
    frozen: held.length - movable.length,
    emptyAccounts: all.length - held.length,
  };
}
