// The command-line client against the isolated LOCAL validator: everything a
// user would need if the website did not exist. No user wallet, no network funds.
//   npx tsx tests/cli-chain.ts
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { hex } from "../sdk/bytes";
import { genesisVault, recoveryPacket } from "../sdk/v3/master";
import { epochSeed } from "../sdk/v3/derive";
import { fetchVault } from "../sdk/v3/chain";
import { DayKey, encryptFile } from "../sdk/v3/kit";
import { refusalText } from "../sdk/v3/refusals";
import { initializeIx, vaultAddress } from "../sdk/v3/protocol";
import {
  describe,
  journalPath,
  openDayKey,
  readBunker,
  release,
  resume,
  review,
  sessionFor,
  submitRecovery,
  withdraw,
} from "../tools/cli/lib";
const PROGRAM = new PublicKey("k7FaK87WHGVXzkaoHb7CdVPgkKDQhZ29VLDeBVbDfYn");
const RPC = "http://127.0.0.1:19099";
const c = new Connection(RPC, "confirmed");
const genesis = await c.getGenesisHash();
if (["5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d", "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"].includes(genesis))
  throw new Error("This test only runs against an isolated local validator");
if (!(await c.getAccountInfo(PROGRAM))?.executable) throw new Error("Build bunker3.so and start scripts/local-validator.sh");
const payer = Keypair.generate();
await c.confirmTransaction(await c.requestAirdrop(payer.publicKey, 50_000_000_000));
const dir = mkdtempSync(join(tmpdir(), "bunker-cli-test-"));
const password = "command line day key password";
const check = (condition: boolean, what: string) => {
  if (!condition) throw new Error(`FAILED: ${what}`);
};
const rejects = async (fn: () => Promise<unknown>, needle: string, what: string) => {
  try {
    await fn();
  } catch (e) {
    check(e instanceof Error && e.message.includes(needle), `${what}: wrong refusal: ${e instanceof Error ? e.message : e}`);
    return;
  }
  throw new Error(`FAILED: ${what}: expected a refusal`);
};
async function build(delaySecs: number, trusted: PublicKey[] = []) {
  const master = crypto.getRandomValues(new Uint8Array(32));
  const g = genesisVault(master, {
    chainTag: new PublicKey(genesis).toBytes(),
    programId: PROGRAM.toBytes(),
    salt: crypto.getRandomValues(new Uint8Array(32)),
    delaySecs,
    trusted: trusted.map((t) => t.toBytes()),
  });
  const vault = vaultAddress(PROGRAM, g.d.vaultId);
  await sendAndConfirmTransaction(
    c,
    new Transaction().add(
      initializeIx(PROGRAM, payer.publicKey, { trusted: g.d.trusted, salt: g.d.salt, chainTag: g.d.chainTag, opRoot: g.opRoot, recRoot: g.recRoot, delaySecs }),
      SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: vault, lamports: 3_000_000_000 }),
    ),
    [payer],
  );
  const base = {
    version: 3 as const,
    network: "localnet" as const,
    genesis,
    program: PROGRAM.toBase58(),
    salt: hex(g.d.salt),
    vaultId: hex(g.d.vaultId),
    vault: vault.toBase58(),
    delaySecs,
    trusted: trusted.map((t) => t.toBase58()),
  };
  const dayKey = (epoch: bigint): DayKey => ({ ...base, kind: "day-key", epoch: epoch.toString(), seed: hex(epochSeed(master, g.d, epoch)) });
  const save = async (epoch: bigint) => {
    const path = join(dir, `day-${vault.toBase58().slice(0, 6)}-${epoch}.json`);
    writeFileSync(path, await encryptFile(dayKey(epoch), password));
    return path;
  };
  return { master, g, vault, base, save };
}
const quiet = () => undefined;
try {
  // ── No waiting period: withdraw arrives; a second uses the next key ──────
  const a = await build(0);
  const path0 = await a.save(0n);
  await rejects(() => openDayKey(path0, "the wrong password!!"), "Incorrect password", "wrong password");
  const day = await openDayKey(path0, password);
  const s = sessionFor(day, RPC, payer, quiet);
  const to = Keypair.generate().publicKey;
  check(describe(a.vault.toBase58(), await readBunker(s, a.vault)).some((l) => l.includes("Pending: none")), "status");
  await rejects(() => review(s, day, { to: a.vault.toBase58(), amount: "1" }), "outside this Bunker", "withdraw to the Bunker itself");
  await rejects(() => review(s, day, { to: PROGRAM.toBase58(), amount: "1" }), "not a wallet", "withdraw to a program");
  await rejects(() => review(s, day, { to: to.toBase58(), amount: "99" }), "At most", "more than the balance");
  const first = await review(s, day, { to: to.toBase58(), amount: "0.5" });
  check((await withdraw(s, day, path0, first)).startsWith("Sent."), "instant withdrawal");
  check((await c.getBalance(to)) === 500_000_000, "recipient received 0.5 SOL");
  check(existsSync(journalPath(path0)) && !existsSync(`${journalPath(path0)}.lock`), "journal written, lock released");
  check(!readFileSync(journalPath(path0), "utf8").includes(day.seed), "journal holds no seed");
  // Signing the same review again is refused: the Bunker has moved on.
  await rejects(() => withdraw(s, day, path0, first), "changed after this withdrawal was reviewed", "stale review");
  check((await c.getBalance(to)) === 500_000_000, "not paid twice");
  check((await resume(s, day, path0)) === "Nothing is waiting to be finished.", "nothing to resume");
  const second = await review(s, day, { to: to.toBase58(), amount: "0.25" });
  await withdraw(s, day, path0, second);
  check((await c.getBalance(to)) === 750_000_000, "second withdrawal with the next key");
  check((await fetchVault(c, PROGRAM, a.vault)).state.opIndex === 2n, "two keys used");

  // ── Waiting period: announce, cannot release early, cancel by recovery ───
  const b = await build(86_400);
  const pathB = await b.save(0n);
  const dayB = await openDayKey(pathB, password);
  const sB = sessionFor(dayB, RPC, payer, quiet);
  const thief = Keypair.generate().publicKey;
  check((await withdraw(sB, dayB, pathB, await review(sB, dayB, { to: thief.toBase58(), amount: "2" }))).startsWith("Announced."), "announced");
  check((await c.getBalance(thief)) === 0, "nothing moved at announcement");
  // The program's own reason comes back, and has a sentence.
  await rejects(() => release(sB, b.vault), '"Custom":121', "release before the wait is over");
  check(refusalText('{"InstructionError":[0,{"Custom":121}]}') === "The waiting period is not over yet.", "refusal sentence");
  await rejects(() => review(sB, dayB, { to: thief.toBase58(), amount: "0.1" }), "already pending", "second withdrawal while one waits");
  // The packet comes from the offline tool; here it is built the same way.
  const packet = recoveryPacket(b.master, b.g.d, 0n);
  const packetPath = join(dir, "packet.json");
  const identity = { version: b.base.version, network: b.base.network, genesis: b.base.genesis, program: b.base.program, vaultId: b.base.vaultId, vault: b.base.vault };
  writeFileSync(packetPath, JSON.stringify({ ...identity, kind: "recover", epoch: "0", payload: hex(packet.payload), signature: hex(packet.signature) }));
  check((await submitRecovery(sB, packetPath)).startsWith("Recovered."), "recovery submitted");
  const after = (await fetchVault(c, PROGRAM, b.vault)).state;
  check(after.epoch === 1n && after.pending === null, "new key generation, withdrawal cancelled");
  check((await c.getBalance(thief)) === 0, "the cancelled withdrawal never paid");
  check((await submitRecovery(sB, packetPath)) === "This packet has already been applied.", "same packet again is harmless");
  // The old day key is dead; the new one works.
  await rejects(async () => review(sB, dayB, { to: to.toBase58(), amount: "0.1" }), "has been replaced", "old day key");
  const pathB1 = await b.save(1n);
  const dayB1 = await openDayKey(pathB1, password);
  check((await withdraw(sB, dayB1, pathB1, await review(sB, dayB1, { to: to.toBase58(), amount: "0.1" }))).startsWith("Announced."), "new day key announces");

  // ── Trusted addresses: at once to them, a wait to anyone else ────────────
  const safe = Keypair.generate().publicKey;
  const t = await build(86_400, [safe]);
  const pathT = await t.save(0n);
  const dayT = await openDayKey(pathT, password);
  const sT = sessionFor(dayT, RPC, payer, quiet);
  check(describe(t.vault.toBase58(), await readBunker(sT, t.vault)).some((l) => l.includes(`Trusted address (no wait): ${safe.toBase58()}`)), "status lists trusted addresses");
  const toSafe = await review(sT, dayT, { to: safe.toBase58(), amount: "1" });
  check(toSafe.lines.some((l) => l.includes("trusted address: it leaves immediately")), "review says a trusted address does not wait");
  check((await withdraw(sT, dayT, pathT, toSafe)).startsWith("Sent."), "trusted address is paid at once on a waiting Bunker");
  check((await c.getBalance(safe)) === 1_000_000_000, "trusted address received it");
  const toOther = await review(sT, dayT, { to: thief.toBase58(), amount: "1" });
  check(toOther.lines.some((l) => l.includes("after 86400 seconds of waiting")), "review says anyone else waits");
  check((await withdraw(sT, dayT, pathT, toOther)).startsWith("Announced."), "anyone else only gets an announcement");
  check((await c.getBalance(thief)) === 0, "nothing moved to the untrusted address");

  // ── The program a user actually runs, with its prompts ───────────────────
  const feeWallet = join(dir, "fee-wallet.json");
  writeFileSync(feeWallet, JSON.stringify(Array.from(payer.secretKey)));
  const run = (args: string[], input: string) =>
    spawnSync("npx", ["tsx", "tools/cli/bunker.ts", ...args], { input, encoding: "utf8", timeout: 90_000 });
  const common = ["--rpc", RPC, "--day-key", path0, "--fee-wallet", feeWallet];
  const typed = run(["withdraw", ...common, "--to", to.toBase58(), "--amount", "0.125"], `${password}\nsign\n`);
  check(typed.status === 0 && typed.stdout.includes("Sent."), `command-line withdraw: ${typed.stdout}${typed.stderr}`);
  check(typed.stdout.includes(`Withdraw 0.125 SOL`) && typed.stdout.includes(to.toBase58()), "the review is printed before signing");
  check(!typed.stdout.includes(password), "the password is not echoed");
  check((await c.getBalance(to)) === 875_000_000, "command-line withdrawal arrived");
  // Anything other than the word "sign" signs nothing.
  const declined = run(["withdraw", ...common, "--to", to.toBase58(), "--amount", "0.125"], `${password}\nyes\n`);
  check(declined.status === 1 && declined.stderr.includes("Nothing was signed."), "declined at the prompt");
  check((await c.getBalance(to)) === 875_000_000, "nothing sent when declined");
  check((await fetchVault(c, PROGRAM, a.vault)).state.opIndex === 3n, "no key used when declined");
  const status = run(["status", "--rpc", RPC, "--program", PROGRAM.toBase58(), "--vault", a.vault.toBase58()], "");
  check(status.status === 0 && status.stdout.includes("withdrawals announced 3"), `status: ${status.stdout}${status.stderr}`);
  check(run([], "").stderr.includes("Commands:"), "usage");

  // ── A network other than the day key's is refused before anything is sent ─
  const elsewhere = sessionFor({ ...day, genesis: PublicKey.default.toBase58() }, RPC, payer, quiet);
  await rejects(() => withdraw(elsewhere, day, path0, { ...second, opIndex: 3n }), "does not match the pinned network", "wrong network");
  console.log(JSON.stringify({ commandLine: "ok", network: "isolated local validator", genesis }, null, 2));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
