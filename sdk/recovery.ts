import { z } from "zod";
import { hex, unhex } from "./bytes";
const keyHex = z.string().regex(/^[0-9a-f]{2176}$/);
const rootHex = z.string().regex(/^[0-9a-f]{64}$/);
const pendingSchema = z
  .object({
    payload: z.string().regex(/^[0-9a-f]{226}$/),
    signature: keyHex,
    nextSecret: keyHex,
    nextRoot: rootHex,
    sourceToken: z.string().optional(),
    recipient: z.string(),
  })
  .strict();
export const kitSchema = z
  .object({
    version: z.literal(1),
    network: z.enum(["devnet", "localnet"]),
    genesis: z.string(),
    program: z.string(),
    vaultId: rootHex,
    vault: z.string(),
    nonce: z.string().regex(/^\d+$/),
    root: rootHex,
    secret: keyHex.optional(),
    pending: pendingSchema.optional(),
  })
  .strict()
  .refine(
    (k) => !!k.secret !== !!k.pending,
    "Recovery kit needs exactly one current key or pending withdrawal",
  );
export type RecoveryKit = z.infer<typeof kitSchema>;
const envelopeSchema = z
  .object({
    format: z.literal("bunker-encrypted-v1"),
    kdf: z.literal("PBKDF2-SHA256"),
    iterations: z.literal(600000),
    salt: z.string().regex(/^[0-9a-f]{32}$/),
    iv: z.string().regex(/^[0-9a-f]{24}$/),
    ciphertext: z
      .string()
      .regex(/^[0-9a-f]+$/)
      .max(30000),
  })
  .strict();
const aad = new TextEncoder().encode("BUNKER_RECOVERY_DEVNET_V1");
async function derive(password: string, salt: Uint8Array) {
  if (password.length < 12)
    throw new Error("Use a password with at least 12 characters");
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: salt as BufferSource,
      iterations: 600000,
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
export async function encryptKit(
  kit: RecoveryKit,
  password: string,
): Promise<string> {
  kitSchema.parse(kit);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derive(password, salt);
  const plaintext = new TextEncoder().encode(JSON.stringify(kit));
  try {
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: aad },
      key,
      plaintext,
    );
    return JSON.stringify(
      {
        format: "bunker-encrypted-v1",
        kdf: "PBKDF2-SHA256",
        iterations: 600000,
        salt: hex(salt),
        iv: hex(iv),
        ciphertext: hex(new Uint8Array(ciphertext)),
      },
      null,
      2,
    );
  } finally {
    plaintext.fill(0);
  }
}
export async function decryptKit(
  raw: string,
  password: string,
): Promise<RecoveryKit> {
  if (raw.length > 35000) throw new Error("Recovery file is too large");
  const e = envelopeSchema.parse(JSON.parse(raw));
  const key = await derive(password, unhex(e.salt));
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unhex(e.iv) as BufferSource, additionalData: aad },
      key,
      unhex(e.ciphertext) as BufferSource,
    );
  } catch {
    throw new Error("Incorrect password or damaged recovery file");
  }
  try {
    return kitSchema.parse(JSON.parse(new TextDecoder().decode(plain)));
  } finally {
    new Uint8Array(plain).fill(0);
  }
}
export function downloadKit(
  encrypted: string,
  vault: string,
  nonce: string,
  pending = false,
) {
  const blob = new Blob([encrypted], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `bunker-devnet-${vault.slice(0, 8)}-${nonce}${pending ? "-pending" : ""}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// Only a public digest, never secret material. Mandatory persistent reservation
// survives crashes; the browser lock makes same-origin tab races fail closed.
export async function reserveIntent<T>(
  vault: string,
  nonce: string,
  digest: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (!navigator.locks)
    throw new Error("Use a browser with Web Locks for safe one-time signing");
  return navigator.locks.request(
    `bunker:${vault}`,
    { mode: "exclusive" },
    async () => {
      const key = `bunker-intent-v1:${vault}:${nonce}`;
      const old = localStorage.getItem(key);
      if (old && old !== digest)
        throw new Error(
          "This key already authorized a different withdrawal. Restore its pending recovery file; do not sign again.",
        );
      localStorage.setItem(key, digest);
      if (localStorage.getItem(key) !== digest)
        throw new Error("Cannot persist one-time signing state");
      return operation();
    },
  );
}
