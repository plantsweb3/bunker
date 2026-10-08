/** Protocol 3 key files (DRAFT). Two files with different jobs:
 *  - the ARCHIVAL KIT holds the master. It is created once, never changes, and
 *    is only opened by the recovery tool.
 *  - a DAY KEY holds one epoch's seed. It is what the vault app opens. Losing
 *    or exposing it is recoverable with the archival kit. */
import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import { hex, unhex } from "../bytes";
import { genesisVault } from "./authority";
import type { Descriptor } from "./derive";
import { MAX_DELAY_SECS, MIN_DELAY_SECS, vaultAddress } from "./protocol";
const hex32 = z.string().regex(/^[0-9a-f]{64}$/);
const base = {
  version: z.literal(3),
  network: z.enum(["devnet", "localnet"]),
  genesis: z.string().min(32).max(44),
  program: z.string().min(32).max(44),
  /** Random, chosen when the kit is made. Every key is derived under it. */
  salt: hex32,
  vaultId: hex32,
  vault: z.string().min(32).max(44),
};
export const archivalSchema = z
  .object({
    ...base,
    kind: z.literal("archival"),
    delaySecs: z.number().int().min(MIN_DELAY_SECS).max(MAX_DELAY_SECS),
    master: hex32,
  })
  .strict();
export const dayKeySchema = z
  .object({
    ...base,
    kind: z.literal("day-key"),
    /** The vault's waiting period, so the page can show it from the file and
     * notice a network that reports a different one. */
    delaySecs: z.number().int().min(MIN_DELAY_SECS).max(MAX_DELAY_SECS),
    epoch: z.string().regex(/^(0|[1-9][0-9]*)$/),
    seed: hex32,
  })
  .strict();
export type ArchivalKit = z.infer<typeof archivalSchema>;
export type DayKey = z.infer<typeof dayKeySchema>;
type Identity = Pick<ArchivalKit, "genesis" | "program" | "vaultId" | "vault">;
/** The public identity any Bunker file names. The chain tag is the cluster's
 * genesis hash; the vault address must be the address of its own identity. */
export function identityOf(k: Identity) {
  const program = new PublicKey(k.program);
  const d = {
    chainTag: new PublicKey(k.genesis).toBytes(),
    programId: program.toBytes(),
    vaultId: unhex(k.vaultId, 32),
  };
  if (!vaultAddress(program, d.vaultId).equals(new PublicKey(k.vault)))
    throw new Error("File does not match its vault address");
  return d;
}
/** What a key file's secrets are derived under. */
export function descriptorOf(k: Identity & { salt: string }): Descriptor {
  return { ...identityOf(k), salt: unhex(k.salt, 32) };
}
/** Also proves the kit's master really creates the vault the kit names: the
 * identity is recomputed from the master, the salt and the waiting period. */
export function validateArchival(input: unknown): ArchivalKit {
  const k = archivalSchema.parse(input);
  const d = descriptorOf(k);
  const master = unhex(k.master, 32);
  try {
    if (hex(genesisVault(master, d, k.delaySecs).d.vaultId) !== k.vaultId)
      throw new Error("Recovery kit does not match its vault");
  } finally {
    master.fill(0);
  }
  return k;
}
export function validateDayKey(input: unknown): DayKey {
  const k = dayKeySchema.parse(input);
  descriptorOf(k);
  if (BigInt(k.epoch) > 0xffffffffffffffffn) throw new Error("Invalid epoch");
  return k;
}

const envelopeSchema = z
  .object({
    format: z.literal("bunker3-encrypted-v2"),
    /** In the clear and authenticated, so a page that expects a day key can
     * refuse a recovery kit without ever deriving a key from its password. */
    kind: z.enum(["archival", "day-key"]),
    aead: z.literal("AES-256-GCM"),
    kdf: z.literal("PBKDF2-SHA256"),
    iterations: z.literal(600000),
    salt: z.string().regex(/^[0-9a-f]{32}$/),
    iv: z.string().regex(/^[0-9a-f]{24}$/),
    ciphertext: z.string().regex(/^[0-9a-f]+$/).max(4000),
  })
  .strict();
type Kind = "archival" | "day-key";
const header = (kind: Kind, salt: string, iv: string) =>
  ({
    format: "bunker3-encrypted-v2",
    kind,
    aead: "AES-256-GCM",
    kdf: "PBKDF2-SHA256",
    iterations: 600000,
    salt,
    iv,
  }) as const;
const aad = (kind: Kind, salt: string, iv: string) =>
  new TextEncoder().encode("BUNKER3_KIT_TEST_V2:" + JSON.stringify(header(kind, salt, iv)));
/** A floor, not a guarantee: these files are only as strong as the password. */
export function passwordProblem(password: string): string | null {
  if (password.length < 12) return "Use a password with at least 12 characters";
  if (new Set(password).size < 6 || /^[0-9]+$/.test(password))
    return "That password is too easy to guess. Use several unrelated words.";
  return null;
}
async function key(password: string, salt: Uint8Array, creating = false) {
  const problem = creating ? passwordProblem(password) : null;
  if (problem) throw new Error(problem);
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: 600000 },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
export async function encryptFile(
  file: ArchivalKit | DayKey,
  password: string,
): Promise<string> {
  const canonical =
    file.kind === "archival" ? validateArchival(file) : validateDayKey(file);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const k = await key(password, salt, true);
  const plaintext = new TextEncoder().encode(JSON.stringify(canonical));
  try {
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: aad(file.kind, hex(salt), hex(iv)) },
      k,
      plaintext,
    );
    return JSON.stringify(
      { ...header(file.kind, hex(salt), hex(iv)), ciphertext: hex(new Uint8Array(ciphertext)) },
      null,
      2,
    );
  } finally {
    plaintext.fill(0);
  }
}
const wrongKind = (expected: string) =>
  new Error(`That file is not ${expected}. Check which file you selected.`);
const NAME = { archival: "an archival recovery kit", "day-key": "a day key" } as const;
async function decrypt(raw: string, password: string, expected: Kind): Promise<unknown> {
  if (raw.length > 6000) throw new Error("Key file is too large");
  let e: z.infer<typeof envelopeSchema>;
  try {
    e = envelopeSchema.parse(JSON.parse(raw));
  } catch {
    throw new Error("That is not a Bunker key file");
  }
  // Before the password is used for anything.
  if (e.kind !== expected) throw wrongKind(NAME[expected]);
  const k = await key(password, unhex(e.salt));
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unhex(e.iv) as BufferSource, additionalData: aad(e.kind, e.salt, e.iv) },
      k,
      unhex(e.ciphertext) as BufferSource,
    );
  } catch {
    throw new Error("Incorrect password or damaged key file");
  }
  try {
    return JSON.parse(new TextDecoder().decode(plain));
  } finally {
    new Uint8Array(plain).fill(0);
  }
}
export async function decryptArchival(raw: string, password: string) {
  const v = (await decrypt(raw, password, "archival")) as { kind?: string };
  if (v?.kind !== "archival") throw wrongKind("an archival recovery kit");
  return validateArchival(v);
}
export async function decryptDayKey(raw: string, password: string) {
  const v = (await decrypt(raw, password, "day-key")) as { kind?: string };
  if (v?.kind !== "day-key") throw wrongKind("a day key");
  return validateDayKey(v);
}
export const fileName = (k: ArchivalKit | DayKey) =>
  k.kind === "archival"
    ? `bunker-test-RECOVERY-KIT-${k.vault.slice(0, 8)}.json`
    : `bunker-test-day-key-${k.vault.slice(0, 8)}-epoch-${k.epoch}.json`;
export function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
