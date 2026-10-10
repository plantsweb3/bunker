// Bunker Watch against the isolated LOCAL validator, end to end: the real
// extension, loaded into a real browser, watching a real vault account while
// the command-line client announces a withdrawal from it and a recovery
// packet then cancels it.
//
//   scripts/local-validator.sh        (another terminal)
//   npm run setup:local
//   npx tsx tests/extension/watch-chain.ts
//
// It uses the test build (scripts/build-extension.mjs --test), which is the
// only build that can be pointed at a local network and is never published.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { hex } from "../../sdk/bytes";
import { epochSeed } from "../../sdk/v3/derive";
import { DayKey, encryptFile } from "../../sdk/v3/kit";
import { genesisVault, recoveryPacket } from "../../sdk/v3/master";
import { initializeIx, vaultAddress } from "../../sdk/v3/protocol";
import { openDayKey, review, sessionFor, submitRecovery, withdraw } from "../../tools/cli/lib";

const PROGRAM = new PublicKey("k7FaK87WHGVXzkaoHb7CdVPgkKDQhZ29VLDeBVbDfYn");
const RPC = "http://127.0.0.1:19099";
const c = new Connection(RPC, "confirmed");
const genesis = await c.getGenesisHash();
if (["5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d", "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"].includes(genesis))
  throw new Error("This test only runs against an isolated local validator");
if (!(await c.getAccountInfo(PROGRAM))?.executable) throw new Error("Build bunker3.so and start scripts/local-validator.sh");
const check = (condition: boolean, what: string) => {
  if (!condition) throw new Error(`FAILED: ${what}`);
};
const started = Date.now();
const dir = mkdtempSync(join(tmpdir(), "bunker-watch-test-"));
const password = "watch test day key password";
const payer = Keypair.generate();
await c.confirmTransaction(await c.requestAirdrop(payer.publicKey, 20_000_000_000));

// A Bunker with a one-day wait, built the way the offline tool builds one.
const master = crypto.getRandomValues(new Uint8Array(32));
const g = genesisVault(master, {
  chainTag: new PublicKey(genesis).toBytes(),
  programId: PROGRAM.toBytes(),
  salt: crypto.getRandomValues(new Uint8Array(32)),
  delaySecs: 86_400,
  trusted: [],
});
const vault = vaultAddress(PROGRAM, g.d.vaultId);
await sendAndConfirmTransaction(
  c,
  new Transaction().add(
    initializeIx(PROGRAM, payer.publicKey, { trusted: g.d.trusted, salt: g.d.salt, chainTag: g.d.chainTag, opRoot: g.opRoot, recRoot: g.recRoot, delaySecs: 86_400 }),
    SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: vault, lamports: 3_000_000_000 }),
  ),
  [payer],
);
const identity = { version: 3 as const, network: "localnet" as const, genesis, program: PROGRAM.toBase58(), vaultId: hex(g.d.vaultId), vault: vault.toBase58() };
const dayKey: DayKey = { ...identity, salt: hex(g.d.salt), delaySecs: 86_400, trusted: [], kind: "day-key", epoch: "0", seed: hex(epochSeed(master, g.d, 0n)) };
const dayPath = join(dir, "day.json");
writeFileSync(dayPath, await encryptFile(dayKey, password));

execFileSync(process.execPath, ["scripts/build-extension.mjs", "--test"], { stdio: "inherit" });
const extension = resolve("dist/bunker-watch-test");
const browser = await chromium.launchPersistentContext(join(dir, "profile"), {
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
try {
  const worker = browser.serviceWorkers()[0] ?? (await browser.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  const stored = () => worker.evaluate(() => chrome.storage.local.get(null)) as Promise<Record<string, unknown>>;
  const badge = () => worker.evaluate(() => chrome.action.getBadgeText({})) as Promise<string>;
  const shown = () => worker.evaluate(async () => Object.keys(await chrome.notifications.getAll())) as Promise<string[]>;
  const logged = async () => (((await stored()).log ?? []) as { kind: string; vault: string }[]).map((e) => e.kind);
  /** Waits for the background pass, which the browser runs once a minute. */
  const within = async (what: string, ms: number, done: () => Promise<boolean>) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (await done()) return;
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(`FAILED: ${what} within ${ms / 1000}s`);
  };

  // Start watching, through the popup, as a user would.
  const popup = await browser.newPage();
  const errors: string[] = [];
  popup.on("pageerror", (e) => errors.push(e.message));
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.getByText("LOCAL TEST", { exact: true }).waitFor();
  await popup.getByRole("button", { name: "+ Watch a Bunker" }).click();
  // An address that is not a Bunker of this program is refused.
  await popup.getByLabel("Bunker address").fill(payer.publicKey.toBase58());
  await popup.getByRole("button", { name: "Watch", exact: true }).click();
  await popup.getByRole("alert").filter({ hasText: "No Bunker found" }).waitFor();
  check(((await stored()).watched ?? []).toString() === "", "nothing was stored for an address that is not a Bunker");
  await popup.getByLabel("Bunker address").fill(vault.toBase58());
  await popup.getByRole("button", { name: "Watch", exact: true }).click();
  await popup.locator(`[data-bunker="${vault.toBase58()}"]`).getByText("No withdrawal waiting").waitFor();
  await within("the badge says one Bunker is watched", 20_000, async () => (await badge()) === "1");
  check((await logged()).length === 0, "nothing announced yet");

  // Announce a withdrawal with the command-line client.
  const day = await openDayKey(dayPath, password);
  const session = sessionFor(day, RPC, payer, () => undefined);
  const thief = Keypair.generate().publicKey;
  const said = await withdraw(session, day, dayPath, await review(session, day, { to: thief.toBase58(), amount: "2" }));
  check(said.startsWith("Announced."), "the withdrawal was announced");
  const announcedAt = Date.now();
  await within("the extension reports the announcement", 120_000, async () => (await logged()).includes("announced"));
  console.log(`Announcement noticed after ${Math.round((Date.now() - announcedAt) / 1000)}s.`);
  check(/^\d+h$/.test(await badge()), `the badge shows the hours left (it says "${await badge()}")`);
  const notifications = await shown();
  check(notifications.some((n) => n.startsWith(`announced:${vault.toBase58()}:`)), `a notification is on screen (${notifications.join(", ") || "none"})`);
  await popup.reload();
  await popup.getByRole("heading", { name: /Withdrawal\s*announced\./ }).waitFor();
  const card = popup.locator(`[data-waiting="${vault.toBase58()}"]`);
  check(((await card.textContent()) ?? "").includes("2 SOL"), "the card shows the amount");
  check(((await card.textContent()) ?? "").includes("Not a trusted address"), "the card says it is not a trusted address");
  check(((await card.textContent()) ?? "").includes(thief.toBase58()), "the card shows the whole address it is going to");

  // Cancel it with a recovery packet. The extension reports that too, and the badge goes back.
  const packet = recoveryPacket(master, g.d, 0n);
  const packetPath = join(dir, "packet.json");
  writeFileSync(packetPath, JSON.stringify({ ...identity, kind: "recover", epoch: "0", payload: hex(packet.payload), signature: hex(packet.signature) }));
  check((await submitRecovery(session, packetPath)).startsWith("Recovered."), "recovery submitted");
  await within("the extension reports the recovery", 120_000, async () => (await logged()).includes("recovered"));
  await within("the badge is back to one watched", 10_000, async () => (await badge()) === "1");

  // What it remembers is public chain data and settings. No key of any kind.
  const all = JSON.stringify(await stored());
  for (const secret of [dayKey.seed, hex(master), password]) check(!all.includes(secret), "no secret in the extension's storage");
  check(errors.length === 0, `no errors in the popup (${errors.join("; ")})`);
  console.log(JSON.stringify({ bunkerWatch: "ok", network: "isolated local validator", seconds: Math.round((Date.now() - started) / 1000) }, null, 2));
} finally {
  await browser.close();
  rmSync(dir, { recursive: true, force: true });
}
