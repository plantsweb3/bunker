/** Passkey unlock for a day key (DRAFT).
 *
 * The day key is encrypted with a key that only this device's authenticator
 * can produce (the WebAuthn PRF extension, behind Face ID / fingerprint / PIN).
 * The ciphertext sits in this browser's storage; on its own it is useless.
 *
 * Scope: this protects the DAY key on one device. It is a convenience over the
 * file and password, not a backup: if the device or passkey is gone, the day
 * key is re-issued from the recovery kit. The archival master is never stored. */
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { z } from "zod";
import { hex, unhex } from "../bytes";
import { DayKey, validateDayKey } from "./kit";
const PRF_SALT = sha256(new TextEncoder().encode("BUNKER3_PASSKEY_PRF_V1"));
const KEY_INFO = new TextEncoder().encode("BUNKER3_PASSKEY_AES_V1");
const record = z
  .object({
    version: z.literal(1),
    credentialId: z.string().regex(/^[0-9a-f]+$/).max(2048),
    vault: z.string(),
    epoch: z.string(),
    iv: z.string().regex(/^[0-9a-f]{24}$/),
    ciphertext: z.string().regex(/^[0-9a-f]+$/).max(4000),
  })
  .strict();
export type PasskeyRecord = z.infer<typeof record>;
type Scope = { genesis: string; program: string };
const slot = (s: Scope) => `bunker3-passkey:${s.genesis}:${s.program}`;
type Prf = { prf?: { enabled?: boolean; results?: { first?: BufferSource } } };
const bytes = (b: BufferSource) =>
  b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
/** Whether this browser can offer a device passkey at all. Whether the
 * authenticator supports the extension is only known after creating one. */
export async function passkeyAvailable(): Promise<boolean> {
  try {
    return (
      typeof PublicKeyCredential !== "undefined" &&
      (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())
    );
  } catch {
    return false;
  }
}
export function storedPasskey(s: Scope): PasskeyRecord | null {
  try {
    const raw = localStorage.getItem(slot(s));
    return raw === null ? null : record.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}
export function forgetPasskey(s: Scope) {
  localStorage.removeItem(slot(s));
}
async function aesKey(prfOutput: Uint8Array) {
  if (prfOutput.length !== 32) throw new Error("Unexpected passkey output");
  const raw = hkdf(sha256, prfOutput, new Uint8Array(0), KEY_INFO, 32);
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
const aad = (r: Pick<PasskeyRecord, "credentialId" | "vault" | "epoch">) =>
  new TextEncoder().encode(`BUNKER3_PASSKEY_V1:${r.credentialId}:${r.vault}:${r.epoch}`);
async function assertion(credentialId: Uint8Array): Promise<Uint8Array> {
  const got = (await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rpId: location.hostname,
      allowCredentials: [{ type: "public-key", id: credentialId as BufferSource }],
      userVerification: "required",
      extensions: { prf: { eval: { first: PRF_SALT } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  const first = (got?.getClientExtensionResults() as Prf | undefined)?.prf?.results?.first;
  if (!first) throw new Error("This passkey cannot unlock a day key on this device");
  return bytes(first);
}
/** Creates a passkey on this device and stores the day key encrypted under it. */
export async function savePasskey(day: DayKey): Promise<PasskeyRecord> {
  const canonical = validateDayKey(day);
  const created = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: "Bunker", id: location.hostname },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: `Bunker ${day.vault.slice(0, 8)}`,
        displayName: `Bunker ${day.vault.slice(0, 8)}`,
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "preferred",
        userVerification: "required",
      },
      extensions: { prf: { eval: { first: PRF_SALT } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!created) throw new Error("No passkey was created");
  const ext = created.getClientExtensionResults() as Prf;
  if (!ext.prf?.enabled && !ext.prf?.results?.first)
    throw new Error(
      "This device’s passkey cannot protect a day key. Keep using the key file.",
    );
  const id = new Uint8Array(created.rawId);
  // Some authenticators only evaluate the extension when signing in.
  const output = ext.prf.results?.first ? bytes(ext.prf.results.first) : await assertion(id);
  const head = { credentialId: hex(id), vault: day.vault, epoch: day.epoch };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(canonical));
  try {
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: aad(head) },
      await aesKey(output),
      plaintext,
    );
    const r: PasskeyRecord = {
      version: 1,
      ...head,
      iv: hex(iv),
      ciphertext: hex(new Uint8Array(ciphertext)),
    };
    localStorage.setItem(slot(day), JSON.stringify(record.parse(r)));
    return r;
  } finally {
    plaintext.fill(0);
    output.fill(0);
  }
}
/** Asks the authenticator to unlock the stored day key. */
export async function openPasskey(s: Scope): Promise<DayKey> {
  const r = storedPasskey(s);
  if (!r) throw new Error("No passkey is saved for a Bunker on this device");
  const output = await assertion(unhex(r.credentialId));
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unhex(r.iv) as BufferSource, additionalData: aad(r) },
      await aesKey(output),
      unhex(r.ciphertext) as BufferSource,
    );
    const day = validateDayKey(JSON.parse(new TextDecoder().decode(plain)));
    if (day.vault !== r.vault || day.epoch !== r.epoch || day.genesis !== s.genesis || day.program !== s.program)
      throw new Error("Saved passkey data does not match its Bunker");
    return day;
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Saved passkey")) throw e;
    throw new Error("The passkey did not unlock the saved day key");
  } finally {
    output.fill(0);
  }
}
