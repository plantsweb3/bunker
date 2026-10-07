// Isolated-validator fixtures only. Never imported by the application.
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { createNoopSigner } from '@solana/kit';
import { getInitializeMint2Instruction, getMintToInstruction, getMintSize, getTokenDecoder, getTokenSize } from '@solana-program/token';
import { asAddress, legacyInstruction, TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountIdempotentInstruction } from '../sdk/classic-token';
export const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
export async function createMint(c: Connection, payer: Keypair, authority: PublicKey, freeze: PublicKey | null, decimals: number) {
  const mint = Keypair.generate();
  await sendAndConfirmTransaction(c, new Transaction().add(
    SystemProgram.createAccount({ fromPubkey:payer.publicKey, newAccountPubkey:mint.publicKey, space:getMintSize(), lamports:await c.getMinimumBalanceForRentExemption(getMintSize()), programId:TOKEN_PROGRAM_ID }),
    legacyInstruction(getInitializeMint2Instruction({ mint:asAddress(mint.publicKey), decimals, mintAuthority:asAddress(authority), freezeAuthority:freeze ? asAddress(freeze) : null })),
  ), [payer,mint]);
  return mint.publicKey;
}
export async function getOrCreateAssociatedTokenAccount(c:Connection,payer:Keypair,mint:PublicKey,owner:PublicKey,allowOffCurve=false) {
  const address=await getAssociatedTokenAddress(mint,owner,allowOffCurve);
  await sendAndConfirmTransaction(c,new Transaction().add(createAssociatedTokenAccountIdempotentInstruction(payer.publicKey,address,owner,mint)),[payer]);
  return {address};
}
export async function mintTo(c:Connection,payer:Keypair,mint:PublicKey,token:PublicKey,authority:Keypair,amount:number|bigint) {
  const ix=legacyInstruction(getMintToInstruction({mint:asAddress(mint),token:asAddress(token),mintAuthority:createNoopSigner(asAddress(authority.publicKey)),amount:BigInt(amount)}));
  return sendAndConfirmTransaction(c,new Transaction().add(ix),payer.publicKey.equals(authority.publicKey)?[payer]:[payer,authority]);
}
export async function getAccount(c:Connection,address:PublicKey) {
  const account=await c.getAccountInfo(address);
  if(!account||!account.owner.equals(TOKEN_PROGRAM_ID)||account.data.length!==getTokenSize())throw new Error('Invalid classic token fixture');
  return getTokenDecoder().decode(account.data);
}
