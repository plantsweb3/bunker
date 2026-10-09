import { PublicKey } from "@solana/web3.js";
import type { RewardAccounts } from "./creator-rewards";
import { TOKEN_PROGRAM, WRAPPED_SOL } from "./creator-rewards";

/** pump.fun's bonding-curve program and its exchange program. */
const CURVE_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const EXCHANGE_PROGRAM = new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
const ASSOCIATED_TOKEN_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

/** Where a creator's unclaimed rewards sit. Derived, not looked up: the same
 * wallet always gives the same three addresses. */
export function rewardAccountsOf(creator: string): RewardAccounts {
  const wallet = new PublicKey(creator);
  const [curveVault] = PublicKey.findProgramAddressSync([Buffer.from("creator-vault"), wallet.toBuffer()], CURVE_PROGRAM);
  const [authority] = PublicKey.findProgramAddressSync([Buffer.from("creator_vault"), wallet.toBuffer()], EXCHANGE_PROGRAM);
  const [exchangeVault] = PublicKey.findProgramAddressSync(
    [authority.toBuffer(), new PublicKey(TOKEN_PROGRAM).toBuffer(), new PublicKey(WRAPPED_SOL).toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM,
  );
  return {
    curveVault: curveVault.toBase58(),
    exchangeVault: exchangeVault.toBase58(),
    exchangeAuthority: authority.toBase58(),
  };
}
