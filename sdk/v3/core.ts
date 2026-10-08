/** The parts of protocol 3 that the offline recovery tool needs, with no
 * dependency on a Solana client library: addresses, the vault identity, and
 * the recovery packet's bytes. Everything here works on plain bytes.
 *
 * `protocol.ts` builds the same addresses with `@solana/web3.js`. The two are
 * independent and are compared against each other in the tests. */
import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { concat, u64 } from "../bytes";
export const RECOVER_SIZE = 138;
export const PROTOCOL_VERSION = 3;
export const MIN_DELAY_SECS = 0;
export const MAX_DELAY_SECS = 604_800;
const ROLE_RECOVERY = 2;
const text = (s: string) => new TextEncoder().encode(s);
export const RECOVER_DOMAIN = text("BUNKER3_RECOVER_");
export const VAULT_ID_DOMAIN = text("BUNKER3_VAULT_ID");
const isZero = (b: Uint8Array) => b.every((x) => x === 0);
const same = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((x, i) => x === b[i]);
const bytes32 = (b: Uint8Array, what: string) => {
  if (b.length !== 32) throw new Error(`${what} must be 32 bytes`);
  return b;
};

// ── Base58 (the Bitcoin alphabet Solana addresses use) ──────────────────────
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function base58(b: Uint8Array): string {
  let n = 0n;
  for (const x of b) n = (n << 8n) | BigInt(x);
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  // Each leading zero byte is one leading "1".
  for (let i = 0; i < b.length && b[i] === 0; i++) out = "1" + out;
  return out;
}
/** Decodes a 32-byte address. Rejects anything that is not exactly one. */
export function address(s: string): Uint8Array {
  if (s.length < 32 || s.length > 44) throw new Error("Invalid address");
  let n = 0n;
  for (const ch of s) {
    const digit = ALPHABET.indexOf(ch);
    if (digit < 0) throw new Error("Invalid address");
    n = n * 58n + BigInt(digit);
  }
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  // Too large for 32 bytes, or not the canonical spelling of these bytes.
  if (n !== 0n || base58(out) !== s) throw new Error("Invalid address");
  return out;
}

// ── Program-derived addresses ───────────────────────────────────────────────
const PDA_MARKER = text("ProgramDerivedAddress");
function onCurve(point: Uint8Array): boolean {
  try {
    ed25519.ExtendedPoint.fromHex(point);
    return true;
  } catch {
    return false;
  }
}
/** Solana's rule: the first bump from 255 downwards whose hash is not a point
 * on the curve, so that no private key can exist for the address. */
export function programAddress(seeds: Uint8Array[], programId: Uint8Array): Uint8Array {
  bytes32(programId, "Program id");
  if (seeds.length > 15 || seeds.some((s) => s.length > 32)) throw new Error("Invalid seeds");
  for (let bump = 255; bump >= 0; bump--) {
    const candidate = sha256(concat(...seeds, new Uint8Array([bump]), programId, PDA_MARKER));
    if (!onCurve(candidate)) return candidate;
  }
  throw new Error("No address for these seeds");
}
export const vaultAddressBytes = (programId: Uint8Array, vaultId: Uint8Array) =>
  programAddress([text("bunker3"), bytes32(vaultId, "Vault id")], programId);

// ── Vault identity ──────────────────────────────────────────────────────────
export type Genesis = {
  salt: Uint8Array;
  chainTag: Uint8Array;
  opRoot: Uint8Array;
  recRoot: Uint8Array;
  delaySecs: number;
};
/** `salt || chain_tag || op_root || rec_root || delay_secs`: the data of
 * `initialize`, and the preimage of the vault identity. */
export function genesisData(g: Genesis): Uint8Array {
  if (
    !Number.isInteger(g.delaySecs) ||
    g.delaySecs < MIN_DELAY_SECS ||
    g.delaySecs > MAX_DELAY_SECS ||
    isZero(bytes32(g.opRoot, "Operational root")) ||
    isZero(bytes32(g.recRoot, "Recovery root")) ||
    same(g.opRoot, g.recRoot)
  )
    throw new Error("Invalid vault parameters");
  const delay = new Uint8Array(4);
  new DataView(delay.buffer).setUint32(0, g.delaySecs, true);
  return concat(
    bytes32(g.salt, "Salt"),
    bytes32(g.chainTag, "Chain tag"),
    g.opRoot,
    g.recRoot,
    delay,
  );
}
/** The vault identity: a hash of everything the vault is created with. The
 * program computes the same value, so a vault's address fixes its creation
 * parameters no matter who sends `initialize`. */
export const vaultIdOf = (g: Genesis) => sha256(concat(VAULT_ID_DOMAIN, genesisData(g)));

// ── The recovery packet ─────────────────────────────────────────────────────
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
    isZero(bytes32(r.nextRecRoot, "Next recovery root")) ||
    isZero(bytes32(r.nextOpRoot, "Next operational root")) ||
    same(r.nextRecRoot, r.nextOpRoot)
  )
    throw new Error("Invalid recovery packet");
  return concat(
    new Uint8Array([PROTOCOL_VERSION, ROLE_RECOVERY]),
    bytes32(r.vaultId, "Vault id"),
    bytes32(r.chainTag, "Chain tag"),
    u64(r.epoch),
    r.nextRecRoot,
    r.nextOpRoot,
  );
}
export function decodeRecover(b: Uint8Array): Recover {
  if (b.length !== RECOVER_SIZE || b[0] !== PROTOCOL_VERSION || b[1] !== ROLE_RECOVERY)
    throw new Error("Invalid recovery encoding");
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const r: Recover = {
    vaultId: b.slice(2, 34),
    chainTag: b.slice(34, 66),
    epoch: view.getBigUint64(66, true),
    nextRecRoot: b.slice(74, 106),
    nextOpRoot: b.slice(106, 138),
  };
  encodeRecover(r); // One validation path.
  return r;
}
/** `domain || program || vault address || payload`: the bytes that are signed. */
export function recoverMessageBytes(programId: Uint8Array, payload: Uint8Array): Uint8Array {
  const { vaultId } = decodeRecover(payload);
  return concat(RECOVER_DOMAIN, bytes32(programId, "Program id"), vaultAddressBytes(programId, vaultId), payload);
}
