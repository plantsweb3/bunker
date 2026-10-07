import { Buffer } from 'buffer';
import { Connection, PublicKey, TransactionInstruction } from '@solana/web3.js';
import { address, createNoopSigner, isSignerRole, isWritableRole, type Instruction } from '@solana/kit';
import {
  TOKEN_PROGRAM_ADDRESS, findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction, getTransferCheckedInstruction,
  getMintDecoder, getMintSize,
} from '@solana-program/token';

export const TOKEN_PROGRAM_ID = new PublicKey(TOKEN_PROGRAM_ADDRESS);
export const asAddress = (key: PublicKey) => address(key.toBase58());
// This adapter only maps generated instruction metadata. Signing always happens
// later through the connected Wallet Standard wallet or the local test keypair.
export function legacyInstruction(instruction: Instruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(instruction.programAddress),
    keys: (instruction.accounts ?? []).map(account => ({
      pubkey: new PublicKey(account.address),
      isSigner: isSignerRole(account.role),
      isWritable: isWritableRole(account.role),
    })),
    data: Buffer.from(instruction.data ?? []),
  });
}
export async function getAssociatedTokenAddress(mint: PublicKey, owner: PublicKey, allowOwnerOffCurve = false) {
  if (!allowOwnerOffCurve && !PublicKey.isOnCurve(owner.toBytes())) throw new Error('Token owner must be on curve');
  const [ata] = await findAssociatedTokenPda({ mint: asAddress(mint), owner: asAddress(owner), tokenProgram: TOKEN_PROGRAM_ADDRESS });
  return new PublicKey(ata);
}
export function createAssociatedTokenAccountIdempotentInstruction(payer: PublicKey, ata: PublicKey, owner: PublicKey, mint: PublicKey) {
  return legacyInstruction(getCreateAssociatedTokenIdempotentInstruction({
    payer: createNoopSigner(asAddress(payer)), ata: asAddress(ata), owner: asAddress(owner), mint: asAddress(mint), tokenProgram: TOKEN_PROGRAM_ADDRESS,
  }));
}
export function createTransferCheckedInstruction(source: PublicKey, mint: PublicKey, destination: PublicKey, owner: PublicKey, amount: bigint, decimals: number) {
  return legacyInstruction(getTransferCheckedInstruction({
    source: asAddress(source), mint: asAddress(mint), destination: asAddress(destination),
    authority: createNoopSigner(asAddress(owner)), amount, decimals,
  }));
}
export async function getMint(connection: Connection, mint: PublicKey) {
  const account = await connection.getAccountInfo(mint, 'confirmed');
  if (!account || !account.owner.equals(TOKEN_PROGRAM_ID) || account.data.length !== getMintSize()) throw new Error('Only classic SPL mints are supported');
  const data = getMintDecoder().decode(account.data);
  if (!data.isInitialized) throw new Error('Mint is not initialized');
  return data;
}
