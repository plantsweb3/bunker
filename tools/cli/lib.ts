/** Bunker without the website (DRAFT).
 *
 * Everything the vault page does with a day key, as plain functions over an
 * RPC connection and files on disk: read a Bunker, withdraw, finish an
 * interrupted withdrawal, release, clear, and submit a recovery packet. It
 * uses the same client code as the site, including the signing journal, which
 * here is a file beside the day key instead of browser storage.
 *
 * The recovery kit is never opened here. Making a recovery packet stays in the
 * offline tool.
 *
 * Like the site, on mainnet this sends only to the published Bunker program. */
import "../../sdk/polyfill";
import { existsSync, openSync, closeSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import type { BunkerConfig } from "../../lib/bunker-config";
import { formatAmount, parseAmount, unhex } from "../../sdk/bytes";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddress,
} from "../../sdk/classic-token";
import { Asset, send, withdrawalDestination } from "../../sdk/client";
import { feePreflight, withdrawalPreflight } from "../../sdk/preflight";
import { chainTime, fetchVault, toTrusted, vaultTokens } from "../../sdk/v3/chain";
import { authorizeAnnouncement, journalStatus, SignedAnnouncement } from "../../sdk/v3/journal";
import { DayKey, decryptDayKey, descriptorOf } from "../../sdk/v3/kit";
import {
  announceIx,
  closeProofIx,
  computeIx,
  decodeAnnounce,
  executeIx,
  expireIx,
  MAX_ANNOUNCE_AHEAD_SECS,
  pendingPhase,
  recoverIx,
  stageIxs,
  VaultState,
} from "../../sdk/v3/protocol";
import { parseRecoveryFile, recoveryFileStatus } from "../../sdk/v3/requests";

const ANNOUNCE_WINDOW_SECS = 3600n;
export type Session = {
  connection: Connection;
  config: BunkerConfig;
  program: PublicKey;
  payer: Keypair;
  log: (line: string) => void;
};
/** A fee wallet in the standard Solana keypair file format. It pays fees and
 * has no authority over any Bunker. */
export function readFeeWallet(path: string): Keypair {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!Array.isArray(parsed) || parsed.length !== 64 || parsed.some((n) => !Number.isInteger(n) || n < 0 || n > 255))
    throw new Error("That is not a Solana keypair file (a JSON list of 64 numbers)");
  return Keypair.fromSecretKey(Uint8Array.from(parsed as number[]));
}
/** The network and program come from the Bunker's own file, never from flags:
 * the RPC must be on that network or nothing is sent. */
export function sessionFor(
  identity: { network: BunkerConfig["network"]; genesis: string; program: string },
  rpc: string,
  payer: Keypair,
  log: (line: string) => void = console.log,
): Session {
  const url = new URL(rpc);
  if (url.protocol !== "https:" && !["127.0.0.1", "localhost"].includes(url.hostname))
    throw new Error("Use an https RPC address");
  return {
    connection: new Connection(url.href, "confirmed"),
    config: {
      network: identity.network,
      custodyEnabled: true,
      programId: identity.program,
      expectedGenesis: identity.genesis,
      releaseStatus: "Bunker from the command line.",
      alertsBot: null,
    },
    program: new PublicKey(identity.program),
    payer,
    log,
  };
}
const transmit = (s: Session, label: string, ixs: TransactionInstruction[]) => {
  s.log(label);
  // `send` checks the network and the program, simulates, signs and confirms.
  return send(s.connection, s.config, s.payer.publicKey, ixs, async (tx: Transaction) => {
    tx.partialSign(s.payer);
    return tx;
  });
};

// ── The signing journal, in a file beside the day key ───────────────────────
/** Gives the journal the two things it expects from a browser: storage that
 * survives, and a lock so two runs cannot sign at once. Writes go through a
 * temporary file and a rename so a crash cannot leave half a journal. */
export function fileJournal(path: string) {
  const read = (): Record<string, string> =>
    existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, string>) : {};
  const storage = {
    getItem: (k: string) => read()[k] ?? null,
    setItem: (k: string, v: string) => {
      const next = { ...read(), [k]: v };
      writeFileSync(`${path}.tmp`, JSON.stringify(next, null, 2), { mode: 0o600 });
      renameSync(`${path}.tmp`, path);
    },
    removeItem: (k: string) => {
      const next = read();
      delete next[k];
      writeFileSync(`${path}.tmp`, JSON.stringify(next, null, 2), { mode: 0o600 });
      renameSync(`${path}.tmp`, path);
    },
  };
  const locks = {
    request: async <T>(_name: string, _options: unknown, fn: () => Promise<T>): Promise<T> => {
      let handle: number;
      try {
        handle = openSync(`${path}.lock`, "wx", 0o600);
      } catch {
        throw new Error(
          `Another run is using this day key (or one crashed). If none is running, delete ${path}.lock and try again.`,
        );
      }
      try {
        return await fn();
      } finally {
        closeSync(handle);
        unlinkSync(`${path}.lock`);
      }
    },
  };
  return { storage, locks };
}
function attachJournal(path: string) {
  const j = fileJournal(path);
  const g = globalThis as unknown as { localStorage?: unknown; navigator?: unknown };
  Object.defineProperty(g, "localStorage", { value: j.storage, configurable: true, writable: true });
  Object.defineProperty(g, "navigator", { value: { locks: j.locks }, configurable: true, writable: true });
}
export const journalPath = (dayKeyPath: string) => `${dayKeyPath}.journal.json`;

// ── Reading ─────────────────────────────────────────────────────────────────
export async function openDayKey(path: string, password: string): Promise<DayKey> {
  return decryptDayKey(readFileSync(path, "utf8"), password);
}
export async function readBunker(s: Session, vault: PublicKey) {
  const [found, tokens, now] = await Promise.all([
    fetchVault(s.connection, s.program, vault),
    vaultTokens(s.connection, vault),
    chainTime(s.connection),
  ]);
  return { ...found, tokens, now };
}
export function describe(vault: string, b: Awaited<ReturnType<typeof readBunker>>): string[] {
  const p = b.state.pending;
  return [
    `Bunker ${vault}`,
    `Key generation ${b.state.epoch}, withdrawals announced ${b.state.opIndex}`,
    `Waiting period: ${b.state.delaySecs ? `${b.state.delaySecs} seconds` : "none"}`,
    ...b.state.trusted.map((t) => `Trusted address (no wait): ${t.toBase58()}`),
    `SOL available: ${formatAmount(b.spendable, 9)}`,
    ...b.tokens.filter((t) => t.amount > 0n).map((t) => `Token ${t.mint}: ${formatAmount(t.amount, t.decimals)}${t.frozen ? " (frozen)" : ""}`),
    p
      ? `Pending: ${p.kind === 0 ? `${formatAmount(p.amount, 9)} SOL` : `${p.amount} base units of ${p.mint.toBase58()}`} to ${p.destination.toBase58()} (${pendingPhase(b.state, b.now)})`
      : "Pending: none",
  ];
}
/** A day key is usable only for the Bunker and key generation it was made for. */
function admit(day: DayKey, state: VaultState) {
  if (BigInt(day.epoch) > state.epoch)
    throw new Error(`This day key is for key generation ${day.epoch}; the Bunker is on ${state.epoch}. Submit the recovery packet first.`);
  if (BigInt(day.epoch) !== state.epoch)
    throw new Error(`This day key (generation ${day.epoch}) has been replaced. The Bunker is on generation ${state.epoch}.`);
  sameTerms(day, state);
}
/** The trusted addresses and waiting period are fixed and are in the day key.
 * A connection that reports others is not believed. */
function sameTerms(day: DayKey, state: VaultState) {
  if (
    day.trusted.length !== state.trusted.length ||
    day.trusted.some((t, i) => t !== state.trusted[i].toBase58()) ||
    day.delaySecs !== state.delaySecs
  )
    throw new Error("The network reports different trusted addresses or a different waiting period from the ones this Bunker was built with. Nothing was done.");
}

// ── Withdrawing ─────────────────────────────────────────────────────────────
export type Request = { to: string; amount: string; mint?: string };
export type Reviewed = {
  kind: 0 | 1;
  mint: PublicKey;
  decimals: number;
  amount: bigint;
  recipient: string;
  destination: PublicKey;
  epoch: bigint;
  opIndex: bigint;
  lines: string[];
};
/** Checks a withdrawal and returns exactly what would be signed, for the
 * caller to show and confirm. Signs nothing. */
export async function review(s: Session, day: DayKey, r: Request): Promise<Reviewed> {
  const vault = new PublicKey(day.vault);
  const b = await readBunker(s, vault);
  admit(day, b.state);
  if (b.state.pending) throw new Error("A withdrawal is already pending. Release, clear or cancel it first.");
  const to = new PublicKey(r.to.trim());
  if (!PublicKey.isOnCurve(to.toBytes()) || to.equals(vault))
    throw new Error("Use a normal wallet address outside this Bunker");
  const base = { recipient: to.toBase58(), epoch: b.state.epoch, opIndex: b.state.opIndex };
  const timing = async (w: { kind: 0 | 1; mint: PublicKey; destination: PublicKey }) =>
    b.state.delaySecs === 0
      ? "It leaves immediately and cannot be cancelled."
      : (await toTrusted(b.state, w))
        ? "This is a trusted address: it leaves immediately and cannot be cancelled."
        : `It can leave after ${b.state.delaySecs} seconds of waiting; until then your recovery kit can cancel it.`;
  if (!r.mint) {
    const lamports = parseAmount(r.amount, 9);
    if (lamports > b.spendable) throw new Error(`At most ${formatAmount(b.spendable, 9)} SOL is available`);
    const sol: Asset = { key: "SOL", mint: null, account: null, label: "SOL", amount: b.spendable, decimals: 9, frozen: false };
    await withdrawalPreflight(s.connection, s.payer.publicKey, to, to, sol, lamports);
    return {
      ...base,
      kind: 0,
      mint: PublicKey.default,
      decimals: 9,
      amount: lamports,
      destination: to,
      lines: [
        `Withdraw ${formatAmount(lamports, 9)} SOL`,
        `to ${to.toBase58()}`,
        await timing({ kind: 0, mint: PublicKey.default, destination: to }),
      ],
    };
  }
  const token = b.tokens.find((t) => t.mint === r.mint);
  if (!token) throw new Error("That token is not in the Bunker");
  const amount = parseAmount(r.amount, token.decimals);
  if (amount > token.amount || token.frozen)
    throw new Error(token.frozen ? "This token account is frozen by its issuer" : `At most ${formatAmount(token.amount, token.decimals)} is available`);
  const dest = await withdrawalDestination(s.connection, s.payer.publicKey, to, token);
  await withdrawalPreflight(s.connection, s.payer.publicKey, to, dest.destination, token, amount);
  return {
    ...base,
    kind: 1,
    mint: new PublicKey(token.mint!),
    decimals: token.decimals,
    amount,
    destination: dest.destination,
    lines: [
      `Withdraw ${formatAmount(amount, token.decimals)} of token ${token.mint}`,
      `(${amount} of its smallest unit, assuming ${token.decimals} decimal places)`,
      `to wallet ${to.toBase58()}`,
      `(its token account ${dest.destination.toBase58()})`,
      await timing({ kind: 1, mint: new PublicKey(token.mint!), destination: dest.destination }),
    ],
  };
}
/** Uploads a signed announcement and lands it. Safe to run again with the
 * same bytes; reports success if an earlier attempt already landed. */
async function publish(s: Session, day: DayKey, signed: SignedAnnouncement): Promise<string> {
  const vault = new PublicKey(day.vault);
  const a = decodeAnnounce(signed.payload);
  const landed = (v: VaultState) => v.epoch === a.epoch && v.opIndex > a.opIndex;
  const outcome = (v: VaultState) =>
    v.pending ? "Announced. Nothing has moved; release it when the waiting period ends." : "Sent. It reached its destination.";
  const { state } = await fetchVault(s.connection, s.program, vault);
  // Held to the day key on every read: see `admit`.
  sameTerms(day, state);
  if (landed(state)) return outcome(state);
  if (state.epoch !== a.epoch || state.opIndex !== a.opIndex || state.pending)
    throw new Error("The Bunker's keys were replaced after this withdrawal was signed. It can no longer be announced. Nothing moved.");
  await feePreflight(s.connection, s.payer.publicKey);
  const instant = state.delaySecs === 0 || (await toTrusted(state, a));
  const setup: TransactionInstruction[] = [];
  let source: PublicKey | undefined;
  if (a.kind === 1) {
    if (!signed.recipient) throw new Error("Recipient wallet for this token is unknown");
    source = await getAssociatedTokenAddress(a.mint, vault, true);
    setup.push(createAssociatedTokenAccountIdempotentInstruction(s.payer.publicKey, a.destination, new PublicKey(signed.recipient), a.mint));
  }
  try {
    const stages = stageIxs(s.program, s.payer.publicKey, signed.message, signed.signature);
    for (let i = 0; i < stages.length; i++) await transmit(s, `Step ${i + 1} of 3: publishing the authorization`, [stages[i]]);
    await transmit(s, instant ? "Step 3 of 3: sending" : "Step 3 of 3: announcing", [
      computeIx(),
      announceIx(s.program, s.payer.publicKey, signed.payload, state.opRoot),
      ...setup,
      ...(instant ? [executeIx(s.program, vault, { kind: a.kind, mint: a.mint, destination: a.destination }, source)] : []),
      closeProofIx(s.program, s.payer.publicKey, signed.message),
    ]);
  } catch (e) {
    // A step that was sent may have landed even though it was not confirmed.
    for (let attempt = 0; attempt < 6; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));
      const after = await fetchVault(s.connection, s.program, vault).catch(() => null);
      if (after && landed(after.state)) return outcome(after.state);
    }
    throw e;
  }
  return outcome((await fetchVault(s.connection, s.program, vault)).state);
}
/** Signs exactly what `review` returned, once, and lands it. */
export async function withdraw(s: Session, day: DayKey, dayKeyPath: string, reviewed: Reviewed): Promise<string> {
  attachJournal(journalPath(dayKeyPath));
  const vault = new PublicKey(day.vault);
  const [{ state }, now] = await Promise.all([fetchVault(s.connection, s.program, vault), chainTime(s.connection)]);
  admit(day, state);
  if (state.epoch !== reviewed.epoch || state.opIndex !== reviewed.opIndex)
    throw new Error("The Bunker changed after this withdrawal was reviewed, so it was not signed. A withdrawal may already have gone through: check its status first.");
  const device = BigInt(Math.floor(Date.now() / 1000));
  const by = (device > now ? device : now) + ANNOUNCE_WINDOW_SECS;
  const limit = now + MAX_ANNOUNCE_AHEAD_SECS;
  const signed = await authorizeAnnouncement(
    day,
    unhex(day.seed),
    descriptorOf(day),
    state,
    {
      kind: reviewed.kind,
      mint: reviewed.mint,
      destination: reviewed.destination,
      amount: reviewed.amount,
      announceBy: by < limit ? by : limit,
      decimals: reviewed.kind === 1 ? reviewed.decimals : 0,
    },
    reviewed.kind === 1 ? reviewed.recipient : undefined,
  );
  s.log("Signed. This key is now used; if anything below fails, run `resume`, never `withdraw` again for the same thing.");
  return publish(s, day, signed);
}
/** Finishes a withdrawal that was signed but did not land. Sends the same bytes. */
export async function resume(s: Session, day: DayKey, dayKeyPath: string): Promise<string> {
  attachJournal(journalPath(dayKeyPath));
  const { state } = await fetchVault(s.connection, s.program, new PublicKey(day.vault));
  admit(day, state);
  const status = journalStatus(day, state);
  if (status.state === "unused") return "Nothing is waiting to be finished.";
  if (status.state !== "signed")
    throw new Error("This key was reserved but nothing can be resumed. Install new keys with your recovery kit; do not sign again.");
  return publish(s, day, status.announcement);
}
export async function release(s: Session, vault: PublicKey): Promise<string> {
  const { state } = await fetchVault(s.connection, s.program, vault);
  const p = state.pending;
  if (!p) throw new Error("Nothing is pending");
  await transmit(s, "Releasing", [
    executeIx(s.program, vault, p, p.kind === 1 ? await getAssociatedTokenAddress(p.mint, vault, true) : undefined),
  ]);
  return "Released. The withdrawal reached its destination.";
}
export async function clearExpired(s: Session, vault: PublicKey): Promise<string> {
  await transmit(s, "Clearing", [expireIx(s.program, vault)]);
  return "Expired withdrawal cleared. Nothing moved.";
}
/** Submits a recovery packet made by the offline tool. */
export async function submitRecovery(s: Session, packetPath: string): Promise<string> {
  const file = parseRecoveryFile(readFileSync(packetPath, "utf8"));
  if (file.program !== s.program.toBase58() || file.genesis !== s.config.expectedGenesis)
    throw new Error("That packet was made for a different network or program");
  const vault = new PublicKey(file.vault);
  const { state } = await fetchVault(s.connection, s.program, vault);
  const status = recoveryFileStatus(file, state);
  if (status === "already-applied") return "This packet has already been applied.";
  if (status !== "ready")
    throw new Error(status === "wrong-epoch" ? `This packet is for key generation ${file.epoch}; the Bunker is on ${state.epoch}.` : "The packet's signature does not match this Bunker's recovery key.");
  await feePreflight(s.connection, s.payer.publicKey);
  const stages = stageIxs(s.program, s.payer.publicKey, file.message, file.signatureBytes);
  for (let i = 0; i < stages.length; i++) await transmit(s, `Step ${i + 1} of 3: publishing the recovery packet`, [stages[i]]);
  await transmit(s, "Step 3 of 3: installing new keys", [
    computeIx(),
    recoverIx(s.program, s.payer.publicKey, file.payloadBytes, state),
    closeProofIx(s.program, s.payer.publicKey, file.message),
  ]);
  return "Recovered. Every earlier day key is dead and a withdrawal that was still waiting has been cancelled.";
}
