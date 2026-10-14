/** Taking back a token approval: the token program's Revoke instruction,
 * signed by the account's owner. It is the same one-byte instruction under
 * the classic token program and Token-2022, and touches nothing but the
 * approval: no balance moves. */
import { PublicKey, TransactionInstruction } from "@solana/web3.js";

const PROGRAMS = {
  classic: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
  "token-2022": new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"),
} as const;
const REVOKE = 5;
/** How many go in one transaction, well inside its size limit. */
export const REVOKES_PER_TRANSACTION = 8;

export function revokeIx(account: string, owner: PublicKey, program: keyof typeof PROGRAMS): TransactionInstruction {
  return new TransactionInstruction({
    programId: PROGRAMS[program],
    keys: [
      { pubkey: new PublicKey(account), isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data: Buffer.from([REVOKE]),
  });
}
