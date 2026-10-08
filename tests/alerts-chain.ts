// The alert watcher against the compiled program on the isolated LOCAL
// validator. Telegram is replaced by a list; the store is in memory.
//   npx tsx tests/alerts-chain.ts
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { handleUpdate } from "../lib/alerts/commands";
import { MemoryStore } from "../lib/alerts/store";
import { runWatch } from "../lib/alerts/watch";
import { genesisAuthorities, recoveryPacket, signAnnouncement } from "../sdk/v3/authority";
import { chainTime, fetchVault } from "../sdk/v3/chain";
import { Descriptor } from "../sdk/v3/derive";
import {
  announceIx,
  closeProofIx,
  computeIx,
  executeIx,
  initializeIx,
  recoverIx,
  stageIxs,
  vaultAddress,
} from "../sdk/v3/protocol";
const PROGRAM = new PublicKey("k7FaK87WHGVXzkaoHb7CdVPgkKDQhZ29VLDeBVbDfYn");
const c = new Connection("http://127.0.0.1:19099", "confirmed");
const genesis = await c.getGenesisHash();
if (["5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d", "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"].includes(genesis))
  throw new Error("This test only runs against an isolated local validator");
if (!(await c.getAccountInfo(PROGRAM))?.executable) throw new Error("Build bunker3.so and start scripts/local-validator.sh");
const payer = Keypair.generate();
await c.confirmTransaction(await c.requestAirdrop(payer.publicKey, 50_000_000_000));
const send = (...ixs: TransactionInstruction[]) => sendAndConfirmTransaction(c, new Transaction().add(...ixs), [payer]);
const store = new MemoryStore();
const sent: { chat: string; text: string }[] = [];
const pass = async () => {
  const before = sent.length;
  store.unlock();
  const result = await runWatch({
    store,
    connection: c,
    program: PROGRAM,
    send: async (chat, text) => void sent.push({ chat, text }),
    link: () => null,
  });
  if (result.errors) throw new Error(`Watcher reported ${result.errors} error(s)`);
  return sent.slice(before).map((m) => m.text);
};
const expectOne = (texts: string[], ...needles: string[]) => {
  if (texts.length !== 1) throw new Error(`Expected one alert, got ${texts.length}: ${texts.join(" | ")}`);
  for (const n of needles) if (!texts[0].includes(n)) throw new Error(`Alert missing "${n}":\n${texts[0]}`);
};
const none = (texts: string[], when: string) => {
  if (texts.length) throw new Error(`Unexpected alert ${when}: ${texts[0]}`);
};
async function vaultWith(delaySecs: number) {
  const master = crypto.getRandomValues(new Uint8Array(32));
  const d: Descriptor = {
    chainTag: new PublicKey(genesis).toBytes(),
    programId: PROGRAM.toBytes(),
    vaultId: crypto.getRandomValues(new Uint8Array(32)),
  };
  const g = genesisAuthorities(master, d);
  await send(initializeIx(PROGRAM, payer.publicKey, { vaultId: d.vaultId, chainTag: d.chainTag, opRoot: g.opRoot, recRoot: g.recRoot, delaySecs }));
  return { master, d, g, vault: vaultAddress(PROGRAM, d.vaultId) };
}
const start = (vault: PublicKey) =>
  handleUpdate({ message: { text: `/start ${vault.toBase58()}`, chat: { id: 4242, type: "private" } } }, { store, connection: c, program: PROGRAM });
const recipient = Keypair.generate().publicKey;
const announce = async (v: Awaited<ReturnType<typeof vaultWith>>, amount: bigint, instant: boolean) => {
  const { state } = await fetchVault(c, PROGRAM, v.vault);
  const s = signAnnouncement(v.g.seed, v.d, { epoch: 0n, opIndex: state.opIndex, kind: 0, mint: PublicKey.default, destination: recipient, amount, announceBy: (await chainTime(c)) + 600n });
  for (const ix of stageIxs(PROGRAM, payer.publicKey, s.message, s.signature)) await send(ix);
  await send(
    computeIx(),
    announceIx(PROGRAM, payer.publicKey, s.payload, state.opRoot),
    ...(instant ? [executeIx(PROGRAM, v.vault, { kind: 0, mint: PublicKey.default, destination: recipient })] : []),
    closeProofIx(PROGRAM, payer.publicKey, s.message),
  );
};

// A Bunker with a 24-hour waiting period.
const waiting = await vaultWith(86_400);
const welcome = await start(waiting.vault);
if (!welcome?.text.includes("Watching Bunker")) throw new Error("Subscription was refused");
none(await pass(), "for history before subscribing");
await send(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: waiting.vault, lamports: 3_000_000_000 }));
expectOne(await pass(), "deposit received", "+3 SOL");
await announce(waiting, 1_250_000_000n, false);
expectOne(await pass(), "ANNOUNCED", "1.25 SOL", recipient.toBase58(), "It can leave in ", "bunkermode.io/recovery");
none(await pass(), "on a second pass with nothing new");
const { state } = await fetchVault(c, PROGRAM, waiting.vault);
const packet = recoveryPacket(waiting.master, waiting.d, 0n);
for (const ix of stageIxs(PROGRAM, payer.publicKey, packet.message, packet.signature)) await send(ix);
await send(computeIx(), recoverIx(PROGRAM, payer.publicKey, packet.payload, state), closeProofIx(PROGRAM, payer.publicKey, packet.message));
expectOne(await pass(), "NEW KEYS were installed", "Withdraw everything");

// A Bunker with no waiting period: the alert arrives after the money has gone.
const instant = await vaultWith(0);
await start(instant.vault);
await send(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: instant.vault, lamports: 2_000_000_000 }));
expectOne(await pass(), "deposit received", "+2 SOL");
await announce(instant, 500_000_000n, true);
expectOne(await pass(), "a withdrawal left your Bunker", "−0.5 SOL", "Your day key is compromised");

// Traffic cannot hide an alert. A thief floods the Bunker's address with
// transactions and then announces: the announcement is still reported.
const flooded = await vaultWith(86_400);
await start(flooded.vault);
await send(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: flooded.vault, lamports: 2_000_000_000 }));
expectOne(await pass(), "deposit received");
await announce(flooded, 700_000_000n, false);
for (let i = 0; i < 15; i++)
  await send(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: flooded.vault, lamports: 1 + i }));
expectOne(await pass(), "ANNOUNCED", "0.7 SOL");

// Traffic cannot fake one. A stranger recovers a Bunker of their own in a
// transaction that also touches the watched Bunker: no false alarm.
const strangers = await vaultWith(0);
const own = recoveryPacket(strangers.master, strangers.d, 0n);
for (const ix of stageIxs(PROGRAM, payer.publicKey, own.message, own.signature)) await send(ix);
await send(
  computeIx(),
  SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: flooded.vault, lamports: 1 }),
  recoverIx(PROGRAM, payer.publicKey, own.payload, (await fetchVault(c, PROGRAM, strangers.vault)).state),
  closeProofIx(PROGRAM, payer.publicKey, own.message),
);
none(await pass(), "after a stranger's recovery that only touched the watched Bunker");

// An address that is not a Bunker cannot be watched, and /stop ends everything.
const refused = await handleUpdate({ message: { text: `/start ${payer.publicKey.toBase58()}`, chat: { id: 4242, type: "private" } } }, { store, connection: c, program: PROGRAM });
if (!refused?.text.includes("not a Bunker")) throw new Error("A non-Bunker address was accepted");
await handleUpdate({ message: { text: "/stop", chat: { id: 4242, type: "private" } } }, { store, connection: c, program: PROGRAM });
await send(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: instant.vault, lamports: 1_000_000 }));
none(await pass(), "after /stop");
console.log(JSON.stringify({ alerts: sent.length, network: "isolated local validator", genesis }, null, 2));
