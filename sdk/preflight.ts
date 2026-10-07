/** Checks that can make a withdrawal fail on-chain, run BEFORE the one-time key
 * is used. Under protocol 2 a withdrawal that cannot land before its expiry
 * leaves the key consumed with no replacement, so anything knowable in advance
 * must stop the flow before signing rather than after. */
import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "./classic-token";
import type { Asset } from "./client";
import { formatAmount } from "./bytes";
export const PROOF_ACCOUNT_SIZE = 1162;
export const SPENT_MARKER_SIZE = 8;
export const TOKEN_ACCOUNT_SIZE = 165;
/** Three transactions plus headroom; fees are 5,000 lamports per signature. */
export const FEE_BUFFER_LAMPORTS = 100_000n;
export type TokenDestination =
  | { exists: false }
  | {
      exists: true;
      tokenProgram: boolean;
      mint: string | null;
      owner: string | null;
      frozen: boolean;
    };
export type PreflightFacts = {
  kind: "sol" | "token";
  amount: bigint;
  mint: string | null;
  recipient: string;
  payerLamports: bigint;
  /** SOL only: current balance of the destination address. */
  destinationLamports: bigint;
  /** SOL only: false when the address is a program or an account a program owns. */
  destinationIsWallet: boolean;
  /** Token only: state of the recipient's associated token account. */
  tokenDestination: TokenDestination | null;
  rent: { empty: bigint; proof: bigint; marker: bigint; tokenAccount: bigint };
};
const sol = (lamports: bigint) => `${formatAmount(lamports, 9)} SOL`;
/** Returns a user-facing reason to stop, or null when nothing known blocks it. */
export function withdrawalBlocker(f: PreflightFacts): string | null {
  let needed = f.rent.proof + f.rent.marker + FEE_BUFFER_LAMPORTS;
  if (f.kind === "sol") {
    if (!f.destinationIsWallet)
      return "That address is a program or an account controlled by a program, not a wallet. SOL sent there may be unrecoverable. Use a wallet address. Nothing was signed.";
    if (f.destinationLamports + f.amount < f.rent.empty)
      return `The recipient would hold less than the network minimum of ${sol(f.rent.empty)}, so this transfer would be rejected. Send at least ${sol(f.rent.empty - f.destinationLamports)} or choose an address that already holds SOL. Nothing was signed.`;
  } else {
    const d = f.tokenDestination;
    if (!d) return "The recipient token account could not be checked.";
    if (!d.exists) needed += f.rent.tokenAccount;
    else if (!d.tokenProgram || d.mint !== f.mint || d.owner !== f.recipient)
      return "The recipient’s token account for this mint is not a standard account they own. Choose a different recipient. Nothing was signed.";
    else if (d.frozen)
      return "The recipient’s token account is frozen by the token issuer and cannot receive this transfer. Nothing was signed.";
  }
  if (f.payerLamports < needed)
    return `Your connected wallet needs about ${sol(needed)} to pay for this withdrawal (network fees and temporary account deposits) and holds ${sol(f.payerLamports)}. Add SOL to it first. Nothing was signed.`;
  return null;
}
export async function withdrawalPreflight(
  connection: Connection,
  payer: PublicKey,
  recipient: PublicKey,
  /** The exact destination that will be signed: the recipient for SOL, their token account otherwise. */
  destination: PublicKey,
  asset: Asset,
  amount: bigint,
): Promise<void> {
  const [payerLamports, destinationInfo, empty, proof, marker, tokenAccount] =
    await Promise.all([
      connection.getBalance(payer),
      connection.getParsedAccountInfo(destination),
      connection.getMinimumBalanceForRentExemption(0),
      connection.getMinimumBalanceForRentExemption(PROOF_ACCOUNT_SIZE),
      connection.getMinimumBalanceForRentExemption(SPENT_MARKER_SIZE),
      connection.getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_SIZE),
    ]);
  const info = destinationInfo.value;
  const parsed =
    info && "parsed" in info.data ? info.data.parsed?.info : undefined;
  const blocker = withdrawalBlocker({
    kind: asset.mint ? "token" : "sol",
    amount,
    mint: asset.mint,
    recipient: recipient.toBase58(),
    payerLamports: BigInt(payerLamports),
    destinationLamports: BigInt(info?.lamports ?? 0),
    destinationIsWallet:
      !info || (!info.executable && info.owner.equals(SystemProgram.programId)),
    tokenDestination: !asset.mint
      ? null
      : !info
        ? { exists: false }
        : {
            exists: true,
            tokenProgram: info.owner.equals(TOKEN_PROGRAM_ID),
            mint: typeof parsed?.mint === "string" ? parsed.mint : null,
            owner: typeof parsed?.owner === "string" ? parsed.owner : null,
            frozen: parsed?.state === "frozen",
          },
    rent: {
      empty: BigInt(empty),
      proof: BigInt(proof),
      marker: BigInt(marker),
      tokenAccount: BigInt(tokenAccount),
    },
  });
  if (blocker) throw new Error(blocker);
}
