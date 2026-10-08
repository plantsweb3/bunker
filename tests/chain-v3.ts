// Protocol 3 draft: repeated full cycles against the isolated LOCAL validator,
// using the same client code as the app. No user wallet, no network funds.
//   CYCLES=25 npx tsx tests/chain-v3.ts
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { genesisVault, recoveryPacket, signAnnouncement } from "../sdk/v3/authority";
import { Descriptor } from "../sdk/v3/derive";
import { chainTime, fetchVault } from "../sdk/v3/chain";
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
if (
  ["5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d", "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"].includes(genesis)
)
  throw new Error("This test only runs against an isolated local validator");
if (!(await c.getAccountInfo(PROGRAM))?.executable)
  throw new Error("Build bunker3.so and restart scripts/local-validator.sh");
const cycles = Number(process.env.CYCLES ?? 25);
const payer = Keypair.generate();
await c.confirmTransaction(await c.requestAirdrop(payer.publicKey, 500_000_000_000));
const send = (...ixs: TransactionInstruction[]) =>
  sendAndConfirmTransaction(c, new Transaction().add(...ixs), [payer]);
const fails = async (label: string, ...ixs: TransactionInstruction[]) => {
  try {
    await send(...ixs);
  } catch {
    return;
  }
  throw new Error(`Expected rejection: ${label}`);
};
const stage = async (message: Uint8Array, signature: Uint8Array) => {
  for (const ix of stageIxs(PROGRAM, payer.publicKey, message, signature)) await send(ix);
};
const SOL = 1_000_000_000n;
const counts = { vaults: 0, instant: 0, waiting: 0, recoveries: 0, rejections: 0 };
const started = Date.now();
for (let n = 0; n < cycles; n++) {
  const master = crypto.getRandomValues(new Uint8Array(32));
  const instant = n % 2 === 0;
  const g = genesisVault(
    master,
    {
      chainTag: new PublicKey(genesis).toBytes(),
      programId: PROGRAM.toBytes(),
      salt: crypto.getRandomValues(new Uint8Array(32)),
    },
    instant ? 0 : 86_400,
  );
  const d: Descriptor = g.d;
  const vault = vaultAddress(PROGRAM, d.vaultId);
  await send(
    initializeIx(PROGRAM, payer.publicKey, {
      salt: d.salt,
      chainTag: d.chainTag,
      opRoot: g.opRoot,
      recRoot: g.recRoot,
      delaySecs: g.delaySecs,
    }),
    SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: vault, lamports: 2n * SOL }),
  );
  counts.vaults++;
  const recipient = Keypair.generate().publicKey;
  const balance = () => c.getBalance(recipient);
  const withdrawal = async (seed: Uint8Array, epoch: bigint, opIndex: bigint, amount: bigint) =>
    signAnnouncement(seed, d, {
      epoch,
      opIndex,
      kind: 0,
      mint: PublicKey.default,
      destination: recipient,
      amount,
      announceBy: (await chainTime(c)) + 600n,
    });
  // Nothing can leave before anything is announced.
  await fails("execute with nothing pending", executeIx(PROGRAM, vault, { kind: 0, mint: PublicKey.default, destination: recipient }));
  counts.rejections++;
  let { state } = await fetchVault(c, PROGRAM, vault);
  const first = await withdrawal(g.seed, 0n, 0n, SOL / 2n);
  await stage(first.message, first.signature);
  const announce = announceIx(PROGRAM, payer.publicKey, first.payload, state.opRoot);
  const execute = executeIx(PROGRAM, vault, { kind: 0, mint: PublicKey.default, destination: recipient });
  if (instant) {
    // A different recipient in the same transaction fails the whole transaction.
    const thief = Keypair.generate().publicKey;
    await fails("redirected execution", computeIx(), announce, executeIx(PROGRAM, vault, { kind: 0, mint: PublicKey.default, destination: thief }));
    counts.rejections++;
    await send(computeIx(), announce, execute, closeProofIx(PROGRAM, payer.publicKey, first.message));
    if (BigInt(await balance()) !== SOL / 2n) throw new Error("Instant withdrawal did not arrive");
    await fails("second execution", execute);
    counts.rejections++;
    counts.instant++;
  } else {
    await send(computeIx(), announce, closeProofIx(PROGRAM, payer.publicKey, first.message));
    if ((await balance()) !== 0) throw new Error("A waiting withdrawal moved funds");
    await fails("execution during the waiting period", execute);
    counts.rejections++;
    counts.waiting++;
  }
  ({ state } = await fetchVault(c, PROGRAM, vault));
  if (state.epoch !== 0n || state.opIndex !== 1n || (state.pending === null) !== instant)
    throw new Error("Unexpected state after the first withdrawal");
  // The spent key cannot announce again.
  const replay = await withdrawal(g.seed, 0n, 0n, 1n);
  await stage(replay.message, replay.signature);
  await fails("announcement with a spent key", computeIx(), announceIx(PROGRAM, payer.publicKey, replay.payload, state.opRoot));
  counts.rejections++;
  // Recovery: cancels a waiting withdrawal and installs the next epoch.
  const before = await balance();
  const packet = recoveryPacket(master, d, 0n);
  await stage(packet.message, packet.signature);
  await send(computeIx(), recoverIx(PROGRAM, payer.publicKey, packet.payload, state), closeProofIx(PROGRAM, payer.publicKey, packet.message));
  ({ state } = await fetchVault(c, PROGRAM, vault));
  if (state.epoch !== 1n || state.opIndex !== 0n || state.pending !== null)
    throw new Error("Recovery did not install a clean epoch");
  if ((await balance()) !== before) throw new Error("Recovery moved funds");
  await fails("execution of a cancelled withdrawal", execute);
  await fails("the same recovery packet again", computeIx(), recoverIx(PROGRAM, payer.publicKey, packet.payload, state));
  counts.rejections += 2;
  counts.recoveries++;
  // The new epoch's seed works; in an instant vault the funds arrive.
  const next = await withdrawal(packet.nextSeed, 1n, 0n, SOL / 4n);
  await stage(next.message, next.signature);
  await send(
    computeIx(),
    announceIx(PROGRAM, payer.publicKey, next.payload, state.opRoot),
    ...(instant ? [execute] : []),
    closeProofIx(PROGRAM, payer.publicKey, next.message),
  );
  const expected = instant ? SOL / 2n + SOL / 4n : 0n;
  if (BigInt(await balance()) !== expected) throw new Error("Unexpected recipient balance after recovery");
  ({ state } = await fetchVault(c, PROGRAM, vault));
  if (state.epoch !== 1n || state.opIndex !== 1n) throw new Error("Unexpected final state");
}
console.log(
  JSON.stringify(
    { protocolVersion: 3, draft: true, network: "isolated local validator", genesis, program: PROGRAM.toBase58(), cycles, ...counts, seconds: Math.round((Date.now() - started) / 1000) },
    null,
    2,
  ),
);
