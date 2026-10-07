import "./polyfill";
import { Buffer } from "buffer";
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "./classic-token";
import { sha256 } from "@noble/hashes/sha256";
import { concat, u64, readU64 } from "./bytes";
export const DOMAIN = new TextEncoder().encode("BUNKER_WITHDRAW_TEST");
export const PROTOCOL_VERSION = 2;
export const INTENT_SIZE = 154;
export const VAULT_SIZE = 81;
export type Intent = {
  vaultId: Uint8Array;
  expirySlot: bigint;
  nonce: bigint;
  kind: 0 | 1;
  mint: PublicKey;
  destination: PublicKey;
  amount: bigint;
  nextRoot: Uint8Array;
};
export function vaultAddress(program: PublicKey, id: Uint8Array): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bunker"), id],
    program,
  )[0];
}
export function proofAddress(
  program: PublicKey,
  payer: PublicKey,
  digest: Uint8Array,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("proof"), payer.toBytes(), digest],
    program,
  )[0];
}
export function encodeIntent(i: Intent): Uint8Array {
  if (
    i.vaultId.length !== 32 ||
    i.expirySlot <= 0n ||
    i.nonce >= 0xffffffffffffffffn ||
    i.nextRoot.length !== 32 ||
    i.nextRoot.every((b) => b === 0) ||
    (i.kind === 0 && !i.mint.equals(PublicKey.default)) ||
    i.amount <= 0n ||
    (i.kind !== 0 && i.kind !== 1)
  )
    throw new Error("Invalid withdrawal intent");
  return concat(
    new Uint8Array([PROTOCOL_VERSION]),
    i.vaultId,
    u64(i.nonce),
    new Uint8Array([i.kind]),
    i.mint.toBytes(),
    i.destination.toBytes(),
    u64(i.amount),
    u64(i.expirySlot),
    i.nextRoot,
  );
}
export function decodeIntent(b: Uint8Array): Intent {
  if (b.length !== INTENT_SIZE || b[0] !== PROTOCOL_VERSION || b[41] > 1)
    throw new Error("Invalid withdrawal encoding or version");
  const intent: Intent = {
    vaultId: b.slice(1, 33),
    nonce: readU64(b, 33),
    kind: b[41] as 0 | 1,
    mint: new PublicKey(b.slice(42, 74)),
    destination: new PublicKey(b.slice(74, 106)),
    amount: readU64(b, 106),
    expirySlot: readU64(b, 114),
    nextRoot: b.slice(122, 154),
  };
  encodeIntent(intent); // One canonical validation path, including zero/overflow cases.
  return intent;
}

export function message(
  program: PublicKey,
  vault: PublicKey,
  payload: Uint8Array,
): Uint8Array {
  const intent = decodeIntent(payload);
  if (!vaultAddress(program, intent.vaultId).equals(vault))
    throw new Error("Signed vault id does not match program/vault");
  return concat(DOMAIN, program.toBytes(), vault.toBytes(), payload);
}
export function spentAddress(program: PublicKey, root: Uint8Array): PublicKey {
  if (root.length !== 32 || root.every((b) => b === 0))
    throw new Error("Missing authority commitment");
  return PublicKey.findProgramAddressSync(
    [Buffer.from("spent-v2"), root],
    program,
  )[0];
}
const meta = (pubkey: PublicKey, isWritable = false, isSigner = false) => ({
  pubkey,
  isWritable,
  isSigner,
});
export function initializeIx(
  program: PublicKey,
  payer: PublicKey,
  id: Uint8Array,
  root: Uint8Array,
) {
  return new TransactionInstruction({
    programId: program,
    keys: [
      meta(payer, true, true),
      meta(vaultAddress(program, id), true),
      meta(SystemProgram.programId),
      meta(spentAddress(program, root)),
    ],
    data: Buffer.from(concat(new Uint8Array([0]), id, root)),
  });
}
export function stageIxs(
  program: PublicKey,
  payer: PublicKey,
  vault: PublicKey,
  payload: Uint8Array,
  signature: Uint8Array,
) {
  if (signature.length !== 1088) throw new Error("Invalid signature");
  const digest = sha256(message(program, vault, payload));
  const proof = proofAddress(program, payer, digest);
  return [0, 600].map((offset) => {
    const o = new Uint8Array(2);
    new DataView(o.buffer).setUint16(0, offset, true);
    return new TransactionInstruction({
      programId: program,
      keys: [
        meta(payer, true, true),
        meta(proof, true),
        meta(SystemProgram.programId),
      ],
      data: Buffer.from(
        concat(
          new Uint8Array([1]),
          digest,
          o,
          signature.slice(offset, offset + 600),
        ),
      ),
    });
  });
}
export function withdrawIx(
  program: PublicKey,
  payer: PublicKey,
  vault: PublicKey,
  payload: Uint8Array,
  currentRoot: Uint8Array,
  sourceToken?: PublicKey,
) {
  const intent = decodeIntent(payload);
  const proof = proofAddress(
    program,
    payer,
    sha256(message(program, vault, payload)),
  );
  const keys = [
    meta(vault, true),
    meta(proof),
    meta(intent.destination, true),
    meta(payer, true, true),
    meta(spentAddress(program, currentRoot), true),
    meta(spentAddress(program, intent.nextRoot)),
    meta(SystemProgram.programId),
  ];
  if (intent.kind === 1) {
    if (!sourceToken) throw new Error("Token source required");
    keys.push(
      meta(sourceToken, true),
      meta(intent.mint),
      meta(TOKEN_PROGRAM_ID),
    );
  }
  return new TransactionInstruction({
    programId: program,
    keys,
    data: Buffer.from(concat(new Uint8Array([2]), payload)),
  });
}
export function computeIx() {
  return ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });
}
export function closeProofIx(
  program: PublicKey,
  payer: PublicKey,
  vault: PublicKey,
  payload: Uint8Array,
) {
  return new TransactionInstruction({
    programId: program,
    keys: [
      meta(
        proofAddress(program, payer, sha256(message(program, vault, payload))),
        true,
      ),
      meta(payer, true, true),
    ],
    data: Buffer.from([3]),
  });
}
export function parseVault(data: Uint8Array) {
  if (
    data.length !== VAULT_SIZE ||
    new TextDecoder().decode(data.slice(0, 8)) !== "BUNKER02"
  )
    throw new Error("Unrecognized Bunker account");
  return {
    id: data.slice(8, 40),
    root: data.slice(40, 72),
    nonce: readU64(data, 72),
    bump: data[80],
  };
}
