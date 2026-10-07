import { z } from "zod";
import { sha256 } from "@noble/hashes/sha256";
import { PublicKey } from "@solana/web3.js";
import { decodeIntent, message, vaultAddress } from "./protocol";
import { rootFromSecret, signOnce, verify } from "./winternitz";
import { hex, unhex, equal } from "./bytes";
const keyHex = z.string().regex(/^[0-9a-f]{2176}$/);
const rootHex = z.string().regex(/^[0-9a-f]{64}$/);
const pendingSchema = z
  .object({
    payload: z.string().regex(/^[0-9a-f]{308}$/),
    signature: keyHex,
    nextSecret: keyHex,
    nextRoot: rootHex,
    sourceToken: z.string().optional(),
    recipient: z.string(),
  })
  .strict();
export const kitSchema = z
  .object({
    version: z.literal(2),
    currentIndex: z.string().regex(/^(0|[1-9][0-9]*)$/),
    nextUnusedIndex: z.string().regex(/^(0|[1-9][0-9]*)$/),
    network: z.enum(["devnet", "localnet"]),
    genesis: z.string(),
    program: z.string(),
    vaultId: rootHex,
    vault: z.string(),
    nonce: z.string().regex(/^(0|[1-9][0-9]*)$/),
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
    format: z.literal("bunker-encrypted-v2"),
    aead: z.literal("AES-256-GCM"),
    tagBits: z.literal(128),
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
function metadata(salt: string, iv: string) {
  return {
    format: "bunker-encrypted-v2",
    aead: "AES-256-GCM",
    tagBits: 128,
    kdf: "PBKDF2-SHA256",
    iterations: 600000,
    salt,
    iv,
  } as const;
}
function aad(salt: string, iv: string) {
  return new TextEncoder().encode(
    "BUNKER_RECOVERY_TEST_V2:" + JSON.stringify(metadata(salt, iv)),
  );
}
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
type PreparedEncryption = { salt: Uint8Array; key: CryptoKey };
/** The slow, fallible part of encryption (600,000 PBKDF2 rounds). Separated so
 * signing can finish it before the one-time key is consumed. */
async function prepareEncryption(
  password: string,
): Promise<PreparedEncryption> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt, key: await derive(password, salt) };
}
export async function encryptKit(
  kit: RecoveryKit,
  password: string,
): Promise<string> {
  return encryptPrepared(kit, await prepareEncryption(password));
}
async function encryptPrepared(
  kit: RecoveryKit,
  { salt, key }: PreparedEncryption,
): Promise<string> {
  const canonical = validateRecoveryKit(kit);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(canonical));
  try {
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: aad(hex(salt), hex(iv)),
        tagLength: 128,
      },
      key,
      plaintext,
    );
    return JSON.stringify(
      {
        ...metadata(hex(salt), hex(iv)),
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
      {
        name: "AES-GCM",
        iv: unhex(e.iv) as BufferSource,
        additionalData: aad(e.salt, e.iv),
        tagLength: 128,
      },
      key,
      unhex(e.ciphertext) as BufferSource,
    );
  } catch {
    throw new Error("Incorrect password or damaged recovery file");
  }
  try {
    return validateRecoveryKit(JSON.parse(new TextDecoder().decode(plain)));
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
  a.download = `bunker-test-v2-${vault.slice(0, 8)}-${nonce}${pending ? "-pending" : ""}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type ChainState = { nonce: bigint; root: Uint8Array; slot: bigint };
export function validateRecoveryKit(input: unknown): RecoveryKit {
  const k = kitSchema.parse(input);
  const n = BigInt(k.currentIndex);
  if (
    k.nonce !== k.currentIndex ||
    n > 0xffffffffffffffffn ||
    BigInt(k.nextUnusedIndex) !== n + (k.pending ? 2n : 1n) ||
    BigInt(k.nextUnusedIndex) > 0xffffffffffffffffn
  )
    throw new Error("Recovery indices are inconsistent");
  const program = new PublicKey(k.program),
    vault = new PublicKey(k.vault);
  if (!vaultAddress(program, unhex(k.vaultId)).equals(vault))
    throw new Error("Recovery vault id mismatch");
  if (k.secret && !equal(rootFromSecret(unhex(k.secret)), unhex(k.root)))
    throw new Error("Recovery key does not match commitment");
  if (k.pending) {
    const p = k.pending,
      intent = decodeIntent(unhex(p.payload));
    if (
      intent.nonce !== n ||
      hex(intent.vaultId) !== k.vaultId ||
      hex(intent.nextRoot) !== p.nextRoot ||
      p.nextRoot === k.root ||
      !equal(rootFromSecret(unhex(p.nextSecret)), intent.nextRoot) ||
      !verify(
        unhex(p.signature),
        message(program, vault, unhex(p.payload)),
        unhex(k.root),
      )
    )
      throw new Error("Pending recovery file is inconsistent");
    const recipient = new PublicKey(p.recipient);
    if (intent.kind === 0 && !recipient.equals(intent.destination))
      throw new Error("Recovery recipient disagrees with signed destination");
    if (intent.kind === 1 && !p.sourceToken)
      throw new Error("Missing token source");
    if (p.sourceToken) new PublicKey(p.sourceToken);
  }
  return k;
}
export function reconcileKit(
  input: RecoveryKit,
  chain: ChainState,
): RecoveryKit {
  const k = validateRecoveryKit(input);
  if (
    k.pending &&
    chain.nonce === BigInt(k.currentIndex) + 1n &&
    hex(chain.root) === k.pending.nextRoot
  ) {
    return validateRecoveryKit({
      ...k,
      nonce: chain.nonce.toString(),
      currentIndex: chain.nonce.toString(),
      root: k.pending.nextRoot,
      secret: k.pending.nextSecret,
      pending: undefined,
    });
  }
  if (chain.nonce !== BigInt(k.currentIndex) || hex(chain.root) !== k.root)
    throw new Error(
      "This recovery file is stale. Recovery and chain commitment disagree.",
    );
  return k; // A failed/expired/unconfirmed pending intent remains consumed, never ready.
}
const journalSchema = z
  .object({
    version: z.literal(2),
    status: z.enum(["ready", "consumed"]),
    currentIndex: z.string(),
    nextUnusedIndex: z.string(),
    root: rootHex,
    digest: rootHex.optional(),
    nextRoot: rootHex.optional(),
    checkpoint: z.string().max(35000),
  })
  .strict();
type Journal = z.infer<typeof journalSchema>;
type Identity = Pick<RecoveryKit, "genesis" | "program" | "vault">;
export const journalKey = (k: Identity) =>
  `bunker-journal-v2:${k.genesis}:${k.program}:${k.vault}`;
function readJournal(k: Identity): Journal | null {
  const value = localStorage.getItem(journalKey(k));
  return value === null ? null : journalSchema.parse(JSON.parse(value));
}
export function recoveryCheckpoint(k: Identity): string | null {
  return readJournal(k)?.checkpoint ?? null;
}
function writeJournal(k: Identity, record: Journal) {
  const encoded = JSON.stringify(journalSchema.parse(record));
  localStorage.setItem(journalKey(k), encoded);
  if (localStorage.getItem(journalKey(k)) !== encoded)
    throw new Error("Cannot persist one-time journal");
}
function publicState(k: RecoveryKit): Omit<Journal, "checkpoint"> {
  return {
    version: 2,
    status: k.pending ? "consumed" : "ready",
    currentIndex: k.currentIndex,
    nextUnusedIndex: k.nextUnusedIndex,
    root: k.root,
    ...(k.pending
      ? {
          digest: hex(
            sha256(
              message(
                new PublicKey(k.program),
                new PublicKey(k.vault),
                unhex(k.pending.payload),
              ),
            ),
          ),
          nextRoot: k.pending.nextRoot,
        }
      : {}),
  };
}
function matches(j: Journal, k: RecoveryKit) {
  const p = publicState(k);
  return (
    j.version === p.version &&
    j.status === p.status &&
    j.currentIndex === p.currentIndex &&
    j.nextUnusedIndex === p.nextUnusedIndex &&
    j.root === p.root &&
    j.digest === p.digest &&
    j.nextRoot === p.nextRoot
  );
}
async function locked<T>(k: Identity, fn: () => Promise<T>): Promise<T> {
  if (!navigator.locks)
    throw new Error("Web Locks are required for one-time signing");
  return navigator.locks.request(journalKey(k), { mode: "exclusive" }, fn);
}
/** Explicit import/create events can bootstrap a journal. Signing itself never can. */
export async function adoptRecovery(
  k: RecoveryKit,
  checkpoint: string,
  chain: ChainState,
  event: "create" | "import" | "reconcile",
): Promise<RecoveryKit> {
  return locked(k, async () => {
    const current = reconcileKit(k, chain),
      old = readJournal(k);
    if (!old && event === "reconcile")
      throw new Error("Journal missing; explicitly import the recovery blob");
    if (old && !matches(old, current) && !matches(old, k))
      throw new Error(
        "Journal and recovery blob disagree. Refusing to sign; restore the consumed intent checkpoint.",
      );
    // A consumed orphan may be recovered only with its exact signed checkpoint.
    writeJournal(k, { ...publicState(current), checkpoint });
    return current;
  });
}
export async function authorizeWithdrawal(
  k: RecoveryKit,
  payload: Uint8Array,
  nextSecret: Uint8Array,
  details: { recipient: string; sourceToken?: string },
  password: string,
  readChain: () => Promise<ChainState>,
): Promise<{ kit: RecoveryKit; encrypted: string }> {
  return locked(k, async () => {
    const current = validateRecoveryKit(k),
      chain = await readChain();
    reconcileKit(current, chain);
    const j = readJournal(k);
    if (
      !j ||
      !matches(j, current) ||
      j.status !== "ready" ||
      !current.secret ||
      current.pending
    )
      throw new Error(
        "Journal, blob, and chain must agree on an unused key. Restore the pending checkpoint; do not sign again.",
      );
    const saved = reconcileKit(await decryptKit(j.checkpoint, password), chain);
    if (JSON.stringify(saved) !== JSON.stringify(current))
      throw new Error("Canonical encrypted recovery blob disagrees");
    const intent = decodeIntent(payload);
    if (BigInt(current.currentIndex) + 2n > 0xffffffffffffffffn)
      throw new Error("Recovery indices exhausted");
    if (
      intent.kind === 0 &&
      !intent.destination.equals(new PublicKey(details.recipient))
    )
      throw new Error("Substituted recipient");
    if (
      intent.nonce !== chain.nonce ||
      hex(intent.vaultId) !== current.vaultId ||
      intent.expirySlot < chain.slot ||
      equal(intent.nextRoot, chain.root) ||
      !equal(rootFromSecret(nextSecret), intent.nextRoot)
    )
      throw new Error("Invalid, expired, or substituted withdrawal intent");
    const msg = message(
      new PublicKey(k.program),
      new PublicKey(k.vault),
      payload,
    );
    // Derive the checkpoint key now. Doing this after consumption left the key
    // spent with no saved signature if the tab closed or derivation failed
    // during the slowest step of the whole flow.
    const prepared = await prepareEncryption(password);
    const consumed: Journal = {
      version: 2,
      status: "consumed",
      currentIndex: k.currentIndex,
      nextUnusedIndex: (BigInt(k.currentIndex) + 2n).toString(),
      root: k.root,
      digest: hex(sha256(msg)),
      nextRoot: hex(intent.nextRoot),
      checkpoint: j.checkpoint,
    };
    // This write MUST complete before the first signature byte is generated.
    // A crash afterward leaves a consumed orphan; it cannot sign, even identically.
    writeJournal(k, consumed);
    const signature = signOnce(unhex(current.secret), msg);
    const pending = validateRecoveryKit({
      ...current,
      secret: undefined,
      nextUnusedIndex: consumed.nextUnusedIndex,
      pending: {
        payload: hex(payload),
        signature: hex(signature),
        nextSecret: hex(nextSecret),
        nextRoot: hex(intent.nextRoot),
        ...details,
      },
    });
    const encrypted = await encryptPrepared(pending, prepared);
    writeJournal(k, { ...consumed, checkpoint: encrypted });
    return { kit: pending, encrypted };
  });
}
