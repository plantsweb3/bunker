/** Public files exchanged between the offline recovery tool and the website
 * (DRAFT). None of them contains a secret: the website can submit them, and
 * anyone who obtains one can do no more than that.
 *
 *  network card      site -> tool   which network and program to build for
 *  creation request  tool -> site   the two public commitments of a new vault
 *  recovery packet   tool -> site   the one signed recovery message for an epoch */
import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import { hex, unhex } from "../bytes";
import { verify } from "../winternitz";
import { descriptorOf } from "./kit";
import {
  decodeRecover,
  MAX_DELAY_SECS,
  RECOVER_SIZE,
  recoverMessage,
  SIGNATURE_SIZE,
  VaultState,
} from "./protocol";
const hex32 = z.string().regex(/^[0-9a-f]{64}$/);
const address = z.string().min(32).max(44);
const network = z.enum(["devnet", "localnet"]);
export const networkCardSchema = z
  .object({
    version: z.literal(3),
    kind: z.literal("network"),
    network,
    genesis: address,
    program: address,
  })
  .strict();
const identity = {
  version: z.literal(3),
  network,
  genesis: address,
  program: address,
  vaultId: hex32,
  vault: address,
};
export const creationRequestSchema = z
  .object({
    ...identity,
    kind: z.literal("create"),
    delaySecs: z.number().int().min(0).max(MAX_DELAY_SECS),
    opRoot: hex32,
    recRoot: hex32,
  })
  .strict();
export const recoveryFileSchema = z
  .object({
    ...identity,
    kind: z.literal("recover"),
    epoch: z.string().regex(/^(0|[1-9][0-9]*)$/),
    payload: z.string().regex(new RegExp(`^[0-9a-f]{${RECOVER_SIZE * 2}}$`)),
    signature: z.string().regex(new RegExp(`^[0-9a-f]{${SIGNATURE_SIZE * 2}}$`)),
  })
  .strict();
export type NetworkCard = z.infer<typeof networkCardSchema>;
export type CreationRequest = z.infer<typeof creationRequestSchema>;
export type RecoveryFile = z.infer<typeof recoveryFileSchema>;
const ZERO = "0".repeat(64);
function parse<T>(schema: z.ZodType<T>, raw: string, what: string): T {
  if (raw.length > 8000) throw new Error("File is too large");
  try {
    return schema.parse(JSON.parse(raw));
  } catch {
    throw new Error(`That file is not ${what}`);
  }
}
export function parseNetworkCard(raw: string): NetworkCard {
  const card = parse(networkCardSchema, raw, "a Bunker network card");
  if (new PublicKey(card.genesis).toBytes().length !== 32) throw new Error("Invalid genesis");
  new PublicKey(card.program);
  return card;
}
export function parseCreationRequest(raw: string): CreationRequest {
  const r = parse(creationRequestSchema, raw, "a Bunker creation request");
  descriptorOf(r); // The vault address must be the PDA of its own id.
  if (r.opRoot === ZERO || r.recRoot === ZERO || r.opRoot === r.recRoot)
    throw new Error("Creation request has invalid commitments");
  return r;
}
/** Checks the file is internally consistent AND that its signature verifies
 * for the message the program will reconstruct. */
export function parseRecoveryFile(raw: string): RecoveryFile & {
  payloadBytes: Uint8Array;
  message: Uint8Array;
  signatureBytes: Uint8Array;
} {
  const f = parse(recoveryFileSchema, raw, "a Bunker recovery packet");
  const d = descriptorOf(f);
  const payloadBytes = unhex(f.payload);
  const r = decodeRecover(payloadBytes);
  if (
    hex(r.vaultId) !== f.vaultId ||
    hex(r.chainTag) !== hex(d.chainTag) ||
    r.epoch.toString() !== f.epoch
  )
    throw new Error("Recovery packet does not match its own description");
  return {
    ...f,
    payloadBytes,
    message: recoverMessage(new PublicKey(f.program), payloadBytes),
    signatureBytes: unhex(f.signature),
  };
}
/** Whether a packet can be applied to the vault as it is on-chain right now. */
export function recoveryFileStatus(
  f: ReturnType<typeof parseRecoveryFile>,
  chain: VaultState,
): "ready" | "already-applied" | "wrong-epoch" | "bad-signature" {
  const epoch = BigInt(f.epoch);
  if (epoch < chain.epoch) return "already-applied";
  if (epoch > chain.epoch) return "wrong-epoch";
  return verify(f.signatureBytes, f.message, chain.recRoot) ? "ready" : "bad-signature";
}
