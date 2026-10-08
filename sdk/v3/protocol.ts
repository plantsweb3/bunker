/** Protocol 3 encodings and instructions (docs/PROTOCOL-3-DRAFT.md §2–§4).
 * DRAFT: mirrors programs/bunker3; not reviewed, not used by the released app. */
import "../polyfill";
import { Buffer } from "buffer";
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha256";
import { TOKEN_PROGRAM_ID } from "../classic-token";
import { concat, readU64, u64 } from "../bytes";
export const VAULT_SIZE = 287;
export const ANNOUNCE_SIZE = 195;
export const RECOVER_SIZE = 138;
export const PROOF_SIZE = 1162;
export const SIGNATURE_SIZE = 1088;
export const PROTOCOL_VERSION = 3;
export const MIN_DELAY_SECS = 86_400;
export const MAX_DELAY_SECS = 604_800;
export const EXECUTE_WINDOW_SECS = 604_800n;
const ROLE_OPERATIONAL = 1;
const ROLE_RECOVERY = 2;
const text = (s: string) => new TextEncoder().encode(s);
export const ANNOUNCE_DOMAIN = text("BUNKER3_ANNOUNCE");
export const RECOVER_DOMAIN = text("BUNKER3_RECOVER_");
const ZERO = new Uint8Array(32);
const isZero = (b: Uint8Array) => b.every((x) => x === 0);
const same = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((x, i) => x === b[i]);
const i64 = (n: bigint) => {
  if (n < -(1n << 63n) || n >= 1n << 63n) throw new Error("Time out of range");
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigInt64(0, n, true);
  return b;
};
const readI64 = (b: Uint8Array, offset: number) =>
  new DataView(b.buffer, b.byteOffset, b.byteLength).getBigInt64(offset, true);
const root32 = (b: Uint8Array, what: string) => {
  if (b.length !== 32) throw new Error(`${what} must be 32 bytes`);
  return b;
};

export const vaultAddress = (program: PublicKey, vaultId: Uint8Array) =>
  PublicKey.findProgramAddressSync([Buffer.from("bunker3"), vaultId], program)[0];
export const proofAddress = (
  program: PublicKey,
  payer: PublicKey,
  digest: Uint8Array,
) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("proof"), payer.toBytes(), digest],
    program,
  )[0];
export function spentAddress(program: PublicKey, root: Uint8Array) {
  if (root.length !== 32 || isZero(root)) throw new Error("Missing commitment");
  return PublicKey.findProgramAddressSync(
    [Buffer.from("spent-v3"), root],
    program,
  )[0];
}

export type Announce = {
  vaultId: Uint8Array;
  chainTag: Uint8Array;
  epoch: bigint;
  opIndex: bigint;
  kind: 0 | 1;
  mint: PublicKey;
  destination: PublicKey;
  amount: bigint;
  /** Unix seconds. The announcement must land at or before this. */
  announceBy: bigint;
  nextOpRoot: Uint8Array;
};
export function encodeAnnounce(a: Announce): Uint8Array {
  if (
    (a.kind !== 0 && a.kind !== 1) ||
    a.amount <= 0n ||
    a.announceBy <= 0n ||
    isZero(root32(a.nextOpRoot, "Next root")) ||
    (a.kind === 0) !== a.mint.equals(PublicKey.default)
  )
    throw new Error("Invalid announcement");
  return concat(
    new Uint8Array([PROTOCOL_VERSION, ROLE_OPERATIONAL]),
    root32(a.vaultId, "Vault id"),
    root32(a.chainTag, "Chain tag"),
    u64(a.epoch),
    u64(a.opIndex),
    new Uint8Array([a.kind]),
    a.mint.toBytes(),
    a.destination.toBytes(),
    u64(a.amount),
    i64(a.announceBy),
    a.nextOpRoot,
  );
}
export function decodeAnnounce(b: Uint8Array): Announce {
  if (
    b.length !== ANNOUNCE_SIZE ||
    b[0] !== PROTOCOL_VERSION ||
    b[1] !== ROLE_OPERATIONAL ||
    b[82] > 1
  )
    throw new Error("Invalid announcement encoding");
  const a: Announce = {
    vaultId: b.slice(2, 34),
    chainTag: b.slice(34, 66),
    epoch: readU64(b, 66),
    opIndex: readU64(b, 74),
    kind: b[82] as 0 | 1,
    mint: new PublicKey(b.slice(83, 115)),
    destination: new PublicKey(b.slice(115, 147)),
    amount: readU64(b, 147),
    announceBy: readI64(b, 155),
    nextOpRoot: b.slice(163, 195),
  };
  encodeAnnounce(a); // One validation path.
  return a;
}
export type Recover = {
  vaultId: Uint8Array;
  chainTag: Uint8Array;
  /** The epoch being left. */
  epoch: bigint;
  nextRecRoot: Uint8Array;
  nextOpRoot: Uint8Array;
};
export function encodeRecover(r: Recover): Uint8Array {
  if (
    isZero(root32(r.nextRecRoot, "Next recovery root")) ||
    isZero(root32(r.nextOpRoot, "Next operational root")) ||
    same(r.nextRecRoot, r.nextOpRoot)
  )
    throw new Error("Invalid recovery packet");
  return concat(
    new Uint8Array([PROTOCOL_VERSION, ROLE_RECOVERY]),
    root32(r.vaultId, "Vault id"),
    root32(r.chainTag, "Chain tag"),
    u64(r.epoch),
    r.nextRecRoot,
    r.nextOpRoot,
  );
}
export function decodeRecover(b: Uint8Array): Recover {
  if (
    b.length !== RECOVER_SIZE ||
    b[0] !== PROTOCOL_VERSION ||
    b[1] !== ROLE_RECOVERY
  )
    throw new Error("Invalid recovery encoding");
  const r: Recover = {
    vaultId: b.slice(2, 34),
    chainTag: b.slice(34, 66),
    epoch: readU64(b, 66),
    nextRecRoot: b.slice(74, 106),
    nextOpRoot: b.slice(106, 138),
  };
  encodeRecover(r);
  return r;
}
/** `domain || program || vault || payload`: the bytes that are signed. */
function signedMessage(
  domain: Uint8Array,
  program: PublicKey,
  vaultId: Uint8Array,
  payload: Uint8Array,
) {
  return concat(
    domain,
    program.toBytes(),
    vaultAddress(program, vaultId).toBytes(),
    payload,
  );
}
export const announceMessage = (program: PublicKey, payload: Uint8Array) =>
  signedMessage(ANNOUNCE_DOMAIN, program, decodeAnnounce(payload).vaultId, payload);
export const recoverMessage = (program: PublicKey, payload: Uint8Array) =>
  signedMessage(RECOVER_DOMAIN, program, decodeRecover(payload).vaultId, payload);

export type Pending = {
  kind: 0 | 1;
  mint: PublicKey;
  destination: PublicKey;
  amount: bigint;
  opensAt: bigint;
  deadline: bigint;
  epoch: bigint;
  digest: Uint8Array;
};
export type VaultState = {
  vaultId: Uint8Array;
  chainTag: Uint8Array;
  opRoot: Uint8Array;
  opIndex: bigint;
  epoch: bigint;
  recRoot: Uint8Array;
  delaySecs: number;
  pending: Pending | null;
  bump: number;
};
export function parseVault(d: Uint8Array): VaultState {
  if (
    d.length !== VAULT_SIZE ||
    new TextDecoder().decode(d.slice(0, 8)) !== "BUNKER03" ||
    d[156] > 1 ||
    (d[156] === 0 && !isZero(d.slice(157, 286))) ||
    (d[156] === 1 && d[157] > 1)
  )
    throw new Error("Unrecognized Bunker account");
  return {
    vaultId: d.slice(8, 40),
    chainTag: d.slice(40, 72),
    opRoot: d.slice(72, 104),
    opIndex: readU64(d, 104),
    epoch: readU64(d, 112),
    recRoot: d.slice(120, 152),
    delaySecs: new DataView(d.buffer, d.byteOffset).getUint32(152, true),
    pending:
      d[156] === 0
        ? null
        : {
            kind: d[157] as 0 | 1,
            mint: new PublicKey(d.slice(158, 190)),
            destination: new PublicKey(d.slice(190, 222)),
            amount: readU64(d, 222),
            opensAt: readI64(d, 230),
            deadline: readI64(d, 238),
            epoch: readU64(d, 246),
            digest: d.slice(254, 286),
          },
    bump: d[286],
  };
}
/** Where a vault's withdrawal stands at `now` (Unix seconds). */
export function pendingPhase(v: VaultState, now: bigint) {
  const p = v.pending;
  if (!p) return "none" as const;
  if (now < p.opensAt) return "waiting" as const;
  return now <= p.deadline ? ("open" as const) : ("expired" as const);
}

const meta = (pubkey: PublicKey, isWritable = false, isSigner = false) => ({
  pubkey,
  isWritable,
  isSigner,
});
const ix = (
  programId: PublicKey,
  keys: ReturnType<typeof meta>[],
  opcode: number,
  data: Uint8Array = new Uint8Array(0),
) =>
  new TransactionInstruction({
    programId,
    keys,
    data: Buffer.from(concat(new Uint8Array([opcode]), data)),
  });
export function initializeIx(
  program: PublicKey,
  payer: PublicKey,
  v: {
    vaultId: Uint8Array;
    chainTag: Uint8Array;
    opRoot: Uint8Array;
    recRoot: Uint8Array;
    delaySecs: number;
  },
) {
  if (
    !Number.isInteger(v.delaySecs) ||
    v.delaySecs < MIN_DELAY_SECS ||
    v.delaySecs > MAX_DELAY_SECS ||
    same(v.opRoot, v.recRoot)
  )
    throw new Error("Invalid vault parameters");
  const delay = new Uint8Array(4);
  new DataView(delay.buffer).setUint32(0, v.delaySecs, true);
  return ix(
    program,
    [
      meta(payer, true, true),
      meta(vaultAddress(program, v.vaultId), true),
      meta(SystemProgram.programId),
      meta(spentAddress(program, v.opRoot)),
      meta(spentAddress(program, v.recRoot)),
    ],
    0,
    concat(
      root32(v.vaultId, "Vault id"),
      root32(v.chainTag, "Chain tag"),
      v.opRoot,
      v.recRoot,
      delay,
    ),
  );
}
/** Two transactions' worth of instructions that upload a signature. */
export function stageIxs(
  program: PublicKey,
  payer: PublicKey,
  message: Uint8Array,
  signature: Uint8Array,
) {
  if (signature.length !== SIGNATURE_SIZE) throw new Error("Invalid signature");
  const digest = sha256(message);
  const proof = proofAddress(program, payer, digest);
  return [0, 600].map((offset) => {
    const o = new Uint8Array(2);
    new DataView(o.buffer).setUint16(0, offset, true);
    return ix(
      program,
      [meta(payer, true, true), meta(proof, true), meta(SystemProgram.programId)],
      1,
      concat(digest, o, signature.slice(offset, offset + 600)),
    );
  });
}
export function announceIx(
  program: PublicKey,
  payer: PublicKey,
  payload: Uint8Array,
  currentOpRoot: Uint8Array,
) {
  const a = decodeAnnounce(payload);
  return ix(
    program,
    [
      meta(vaultAddress(program, a.vaultId), true),
      meta(proofAddress(program, payer, sha256(announceMessage(program, payload)))),
      meta(payer, true, true),
      meta(spentAddress(program, currentOpRoot), true),
      meta(spentAddress(program, a.nextOpRoot)),
      meta(SystemProgram.programId),
    ],
    2,
    payload,
  );
}
/** Permissionless. `sourceToken` is the vault's token account for SPL records. */
export function executeIx(
  program: PublicKey,
  vault: PublicKey,
  pending: Pending,
  sourceToken?: PublicKey,
) {
  const keys = [meta(vault, true), meta(pending.destination, true)];
  if (pending.kind === 1) {
    if (!sourceToken) throw new Error("Token source required");
    keys.push(meta(sourceToken, true), meta(pending.mint), meta(TOKEN_PROGRAM_ID));
  }
  return ix(program, keys, 3);
}
export const expireIx = (program: PublicKey, vault: PublicKey) =>
  ix(program, [meta(vault, true)], 4);
export function recoverIx(
  program: PublicKey,
  payer: PublicKey,
  payload: Uint8Array,
  current: { recRoot: Uint8Array; opRoot: Uint8Array },
) {
  const r = decodeRecover(payload);
  return ix(
    program,
    [
      meta(vaultAddress(program, r.vaultId), true),
      meta(proofAddress(program, payer, sha256(recoverMessage(program, payload)))),
      meta(payer, true, true),
      meta(spentAddress(program, current.recRoot), true),
      meta(spentAddress(program, current.opRoot), true),
      meta(spentAddress(program, r.nextRecRoot)),
      meta(spentAddress(program, r.nextOpRoot)),
      meta(SystemProgram.programId),
    ],
    5,
    payload,
  );
}
export const closeProofIx = (
  program: PublicKey,
  payer: PublicKey,
  message: Uint8Array,
) =>
  ix(
    program,
    [meta(proofAddress(program, payer, sha256(message)), true), meta(payer, true, true)],
    6,
  );
/** Signature verification needs most of a transaction's compute budget. */
export const computeIx = () =>
  ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });
export { ZERO as ZERO_ROOT };
