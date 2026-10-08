import { test, expect, Download, Page, TestInfo } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { parseVault } from "../../sdk/v3/protocol";
import { connect, installLocalWallet } from "./local-wallet";
import { getAssociatedTokenAddress } from "../../sdk/classic-token";
import { createMint, getAccount, getOrCreateAssociatedTokenAccount, mintTo } from "../token-fixture";
// Protocol 3 draft against an isolated LOCAL validator. No user wallet is used.
// The 24-hour wait cannot elapse here; release after the wait is covered by the
// in-process VM suite in programs/bunker3-svm-tests.
const PROGRAM = "k7FaK87WHGVXzkaoHb7CdVPgkKDQhZ29VLDeBVbDfYn";
type Ctx = Awaited<ReturnType<typeof setup>>;
async function setup(page: Page, info: TestInfo, origin = "") {
  test.setTimeout(120000);
  const rpc = "http://127.0.0.1:19099";
  const c = new Connection(rpc, "confirmed");
  let genesis: string;
  try {
    genesis = await c.getGenesisHash();
    if (!(await c.getAccountInfo(new PublicKey(PROGRAM)))?.executable) throw new Error();
  } catch {
    test.skip(true, "Start the local validator with the protocol 3 draft program built");
    throw new Error("skipped");
  }
  if (
    [
      "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
      "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
    ].includes(genesis)
  )
    throw new Error("Custody browser test requires local validator");
  const payer = Keypair.generate(),
    recipient = Keypair.generate();
  await c.requestAirdrop(payer.publicKey, 10_000_000_000);
  for (let i = 0; i < 30 && (await c.getBalance(payer.publicKey)) === 0; i++)
    await new Promise((r) => setTimeout(r, 200));
  await page.route("**/api/config", (r) =>
    r.fulfill({
      json: {
        network: "localnet",
        custodyEnabled: true,
        programId: PROGRAM,
        expectedGenesis: genesis,
        releaseStatus: "Isolated local testing",
      },
    }),
  );
  // Lets a test make the network stop confirming transactions that it still
  // accepts, starting with the nth one sent from now.
  const net = { loseFromSend: 0, sends: 0 };
  await page.route("**/api/rpc", async (route) => {
    const method = (JSON.parse(route.request().postData() ?? "{}") as { method?: string }).method;
    if (method === "sendTransaction") net.sends++;
    if (method === "getSignatureStatuses" && net.loseFromSend && net.sends >= net.loseFromSend)
      return route.fulfill({ status: 503, body: "unavailable" });
    const response = await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: route.request().postData(),
    });
    await route.fulfill({
      status: response.status,
      contentType: "application/json",
      body: await response.text(),
    });
  });
  await installLocalWallet(page, payer);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const password = "local integration test password 2026";
  // Typed into the website; deliberately not the recovery kit's password.
  const dayPassword = "local day key password for tests 2026";
  const save = async (trigger: () => Promise<void>, name: string) => {
    const download = page.waitForEvent("download");
    await trigger();
    const path = info.outputPath(name);
    await (await download).saveAs(path);
    return path;
  };
  const vaultState = async (address: string) =>
    parseVault((await c.getAccountInfo(new PublicKey(address)))!.data);


  // The offline tool is a local file. It must never touch the network.
  const tool = await page.context().newPage();
  const toolRequests: string[] = [];
  tool.on("request", (r) => {
    if (!r.url().startsWith("file:") && !r.url().startsWith("blob:")) toolRequests.push(r.url());
  });
  tool.on("pageerror", (e) => errors.push(`tool: ${e.message}`));
  await tool.goto(`file://${resolve("public/source/bunker-recovery-tool.html")}`);
  /** Runs `trigger` on the tool page and saves the `count` files it downloads, by name. */
  const toolSaves = async (trigger: () => Promise<void>, count: number) => {
    const files: Record<string, string> = {};
    const done = new Promise<void>((finish) => {
      const onDownload = async (d: Download) => {
        const path = info.outputPath(`${Object.keys(files).length}-${d.suggestedFilename()}`);
        await d.saveAs(path);
        files[d.suggestedFilename()] = path;
        if (Object.keys(files).length === count) {
          tool.off("download", onDownload);
          finish();
        }
      };
      tool.on("download", onDownload);
    });
    await trigger();
    await done;
    const find = (part: string) => {
      const name = Object.keys(files).find((n) => n.includes(part));
      if (!name) throw new Error(`Tool did not save a ${part} file`);
      return files[name];
    };
    return find;
  };
  /** Builds a Bunker: kit and keys offline, creation request submitted on the site. */
  const build = async (wait: boolean, trusted: string[] = []) => {
    await page.goto(`${origin}/recovery`);
    await connect(page);
    const card = await save(
      () => page.getByRole("button", { name: "Download network card" }).click(),
      "network-card.json",
    );
    await tool.bringToFront();
    await tool.locator("#card").setInputFiles(card);
    // The tool shows which network and program it is building for.
    await expect(tool.locator("#card-echo")).toContainText(`Program: ${PROGRAM}`);
    await tool.locator("#password").fill(password);
    await tool.locator("#repeat").fill(password);
    await tool.locator("#kit-ack").check();
    await tool.locator("#card-ack").check();
    // The day key may not share the recovery kit's password.
    await tool.locator("#day-password").fill(password);
    await tool.locator("#day-repeat").fill(password);
    await tool.locator("#create").click();
    await expect(tool.locator("#build-status")).toContainText("different password");
    await tool.locator("#day-password").fill(dayPassword);
    await tool.locator("#day-repeat").fill(dayPassword);
    // The tool starts on a 24-hour wait for untrusted addresses, and nothing
    // is created until the statement describing the choice is accepted.
    await expect(tool.locator("#delay")).toHaveValue("86400");
    for (const [i, address] of trusted.entries()) await tool.locator(`#trusted-${i + 1}`).fill(address);
    if (!wait) await tool.locator("#delay").selectOption("0");
    await expect(tool.locator("#policy-text")).toContainText(
      !wait
        ? "no waiting period"
        : trusted.length
          ? "trusted address"
          : "every withdrawal from this Bunker will take 24 hours",
    );
    await tool.locator("#create").click();
    await expect(tool.locator("#build-status")).toContainText("Read and tick the statement");
    await tool.locator("#policy-ack").check();
    // Changing the choice afterwards clears the acceptance.
    await tool.locator("#delay").selectOption("3600");
    await expect(tool.locator("#policy-ack")).not.toBeChecked();
    await tool.locator("#delay").selectOption(wait ? "86400" : "0");
    await tool.locator("#policy-ack").check();
    const kit = (await toolSaves(() => tool.locator("#create").click(), 1))("RECOVERY-KIT");
    const made = await toolSaves(() => tool.locator("#verify").setInputFiles(kit), 2);
    await expect(tool.locator("#build-status")).toContainText("Verified.");
    const day0 = made("day-key");
    const request = made("creation-request");
    // The file that goes to the website holds no secret.
    const masterHex = JSON.stringify(readFileSync(request, "utf8"));
    expect(masterHex).not.toContain("master");
    expect(masterHex).not.toContain("seed");
    await page.bringToFront();
    await page.getByLabel("Creation request", { exact: true }).setInputFiles(request);
    await expect(
      page.getByText(
        !wait ? "None. Withdrawals leave" : trusted.length ? "to any other address" : "on every withdrawal",
        { exact: false },
      ),
    ).toBeVisible();
    for (const address of trusted) await expect(page.getByText(address, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Build Bunker on test network" }).click();
    await expect(page.getByText("Bunker built.", { exact: false })).toBeVisible({ timeout: 25000 });
    const vault = await page.locator(".vault-address code").innerText();
    return { kit, day0, vault };
  };
  /** Makes a recovery packet offline for `epoch` and returns it with the next day key. */
  const makePacket = async (kit: string, epoch: string) => {
    await tool.bringToFront();
    await tool.locator("#tab-recover").click();
    await tool.locator("#kit").setInputFiles(kit);
    await tool.locator("#kit-password").fill(password);
    await tool.locator("#epoch").fill(epoch);
    await tool.locator("#new-day-password").fill(dayPassword);
    await tool.locator("#new-day-repeat").fill(dayPassword);
    const made = await toolSaves(() => tool.locator("#recover").click(), 2);
    await page.bringToFront();
    return { packet: made("recovery-packet"), nextDay: made("day-key") };
  };
  const unseal = async (dayKey: string) => {
    await page.goto(`${origin}/vault`);
    await connect(page);
    await expect(page.getByText("Sealed", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Open with day key" }).click();
    await page.getByLabel("Day key", { exact: true }).setInputFiles(dayKey);
    await page.getByLabel("Day key password", { exact: true }).fill(dayPassword);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Unseal Bunker" }).click();
  };
  const deposit = async (amount: string) => {
    await page.getByRole("button", { name: "Deposit", exact: true }).click();
    await page.getByLabel("Amount", { exact: true }).fill(amount);
    await page.getByRole("button", { name: "Review deposit in wallet" }).click();
    await expect(page.getByText("Deposit confirmed.", { exact: true })).toBeVisible({ timeout: 25000 });
  };
  return { c, recipient, errors, payer, vaultState, build, unseal, deposit, makePacket, toolRequests, net };
}
test("with a waiting period: announce, count down, cancel by recovery, continue with new keys", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const { c, recipient, errors, vaultState, build, unseal, deposit, makePacket, toolRequests }: Ctx = await setup(page, info);
  // 1. Build a Bunker WITH a 24-hour waiting period, opted into explicitly.
  const { kit, day0, vault } = await build(true);
  expect((await vaultState(vault)).delaySecs).toBe(86_400);

  // 2. Open it with the day key and deposit.
  await unseal(day0);
  await expect(page.getByText("Unsealed", { exact: true })).toBeVisible({ timeout: 15000 });
  await deposit("1");
  await expect(page.locator(".vault-balance")).toContainText("1");
  const funded = await c.getBalance(new PublicKey(vault));

  // 3. Announce a withdrawal: recorded, authority rotated, nothing moved.
  await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  await page.getByLabel("Amount", { exact: true }).fill("0.4");
  await page.getByLabel("Recipient wallet address").fill(recipient.publicKey.toBase58());
  await page.getByRole("button", { name: "Review withdrawal" }).click();
  await expect(page.getByText(recipient.publicKey.toBase58())).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Sign and announce" }).click();
  await expect(page.getByText("Withdrawal announced.", { exact: false })).toBeVisible({ timeout: 40000 });
  await expect(page.locator(".door-plate strong")).toHaveText("Waiting period");
  await expect(page.getByText("LEAVES IN", { exact: true })).toBeVisible();
  await expect(page.locator(".pending-clock strong")).toContainText(/^23h 5\dm$/);
  await expect(page.getByRole("button", { name: "Release withdrawal" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Withdraw", exact: true })).toBeDisabled();
  let state = await vaultState(vault);
  expect([state.epoch, state.opIndex, state.pending?.amount]).toEqual([0n, 1n, 400_000_000n]);
  expect(state.pending!.destination.equals(recipient.publicKey)).toBe(true);
  expect(await c.getBalance(new PublicKey(vault))).toBe(funded);
  expect(await c.getBalance(recipient.publicKey)).toBe(0);
  await page.screenshot({ path: info.outputPath("v3-waiting.png"), fullPage: true });

  // 4. Cancel it: the packet is made offline, the site only submits it.
  const stale = await makePacket(kit, "1");
  const { packet, nextDay: day1 } = await makePacket(kit, "0");
  await page.goto("/recovery");
  await connect(page);
  await page.getByRole("tab", { name: "Recover or cancel" }).click();
  // Someone without a day key can still find the number the tool asks for.
  await page.getByPlaceholder("Bunker address").fill(vault);
  await page.getByRole("button", { name: "Look up" }).click();
  await expect(page.getByText("A withdrawal is waiting.", { exact: false })).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".micro", { hasText: "Key generation" }).locator("b")).toHaveText("0");
  await page.getByLabel("Recovery packet", { exact: true }).setInputFiles(stale.packet);
  await expect(page.getByText("Made for a later generation", { exact: false })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("button", { name: /install new keys/i })).toBeDisabled();
  await page.getByLabel("Recovery packet", { exact: true }).setInputFiles(packet);
  await expect(page.getByText("Signature checked against", { exact: false })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("Recovery cancels it if it lands before", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Cancel withdrawal and install new keys" }).click();
  await expect(page.getByText("Recovered.", { exact: false })).toBeVisible({ timeout: 40000 });
  state = await vaultState(vault);
  expect([state.epoch, state.opIndex, state.pending]).toEqual([1n, 0n, null]);
  expect(await c.getBalance(new PublicKey(vault))).toBe(funded);
  expect(await c.getBalance(recipient.publicKey)).toBe(0);

  // 5. The old day key is dead; the new one works.
  await unseal(day0);
  await expect(page.getByText("has been replaced", { exact: false })).toBeVisible({ timeout: 15000 });
  await unseal(day1);
  await expect(page.getByText("Unsealed", { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("LEAVES IN", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  await page.getByLabel("Amount", { exact: true }).fill("0.1");
  await page.getByLabel("Recipient wallet address").fill(recipient.publicKey.toBase58());
  await page.getByRole("button", { name: "Review withdrawal" }).click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Sign and announce" }).click();
  await expect(page.getByText("Withdrawal announced.", { exact: false })).toBeVisible({ timeout: 40000 });
  state = await vaultState(vault);
  expect([state.epoch, state.opIndex, state.pending?.amount]).toEqual([1n, 1n, 100_000_000n]);

  // 6. Seal.
  await page.getByRole("button", { name: "Seal Bunker" }).click();
  await expect(page.getByText("Bunker sealed.", { exact: false })).toBeVisible();
  await expect(page.getByText("Sealed", { exact: true })).toBeVisible();
  expect(toolRequests, "the offline tool made no network request").toEqual([]);
  expect(errors).toEqual([]);
});

test("trusted addresses: instant to them, a cancellable wait to anyone else", async ({ page }, info) => {
  test.setTimeout(150000);
  const { c, recipient, errors, payer, vaultState, build, unseal, deposit }: Ctx = await setup(page, info);
  const mint = await createMint(c, payer, payer.publicKey, null, 6);
  const walletToken = await getOrCreateAssociatedTokenAccount(c, payer, mint, payer.publicKey);
  await mintTo(c, payer, mint, walletToken.address, payer, 500_000_000);
  // A Bunker with a 24-hour wait and one trusted address.
  const trusted = recipient.publicKey;
  const { day0, vault } = await build(true, [trusted.toBase58()]);
  const built = await vaultState(vault);
  expect([built.delaySecs, built.trusted.map((t) => t.toBase58())]).toEqual([86_400, [trusted.toBase58()]]);
  await unseal(day0);
  await expect(page.getByText("Unsealed", { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("except to trusted addresses", { exact: false })).toBeVisible();
  await deposit("2");
  // SOL to the trusted address, picked from the list: no wait.
  await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  await page.getByLabel("Amount", { exact: true }).fill("0.5");
  await page.locator(".trusted-picks button").first().click();
  await expect(page.getByLabel("Recipient wallet address")).toHaveValue(trusted.toBase58());
  await page.getByRole("button", { name: "Review withdrawal" }).click();
  await expect(page.getByText("one of your Bunker’s trusted addresses", { exact: false })).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Sign and send" }).click();
  await expect(page.getByText("Withdrawal sent.", { exact: false })).toBeVisible({ timeout: 40000 });
  expect(await c.getBalance(trusted)).toBe(500_000_000);
  expect((await vaultState(vault)).pending).toBeNull();
  // A token to the trusted address: the program has to find the wallet's
  // real associated token account for this to be instant.
  await page.getByRole("button", { name: "Deposit", exact: true }).click();
  await page.getByLabel("Asset").selectOption({ index: 1 });
  await page.getByLabel("Amount", { exact: true }).fill("300");
  await page.getByRole("button", { name: "Review deposit in wallet" }).click();
  await expect(page.getByText("Deposit confirmed.", { exact: true })).toBeVisible({ timeout: 25000 });
  await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  await page.getByLabel("Asset").selectOption(mint.toBase58());
  await page.getByLabel("Amount", { exact: true }).fill("120");
  await page.getByLabel("Recipient wallet address").fill(trusted.toBase58());
  await page.getByRole("button", { name: "Review withdrawal" }).click();
  await expect(page.getByText("one of your Bunker’s trusted addresses", { exact: false })).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Sign and send" }).click();
  await expect(page.getByText("Withdrawal sent.", { exact: false })).toBeVisible({ timeout: 40000 });
  const trustedToken = await getOrCreateAssociatedTokenAccount(c, payer, mint, trusted);
  expect((await getAccount(c, trustedToken.address)).amount).toBe(120_000_000n);
  // Anyone else: the same day key can only announce, and it waits.
  const stranger = Keypair.generate().publicKey;
  await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  await page.getByLabel("Asset").selectOption("SOL");
  await page.getByLabel("Amount", { exact: true }).fill("1");
  await page.getByLabel("Recipient wallet address").fill(stranger.toBase58());
  await page.getByRole("button", { name: "Review withdrawal" }).click();
  await expect(page.getByText("It can leave after", { exact: false })).toBeVisible();
  await expect(page.getByText("your recovery kit can cancel it", { exact: false })).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Sign and announce" }).click();
  await expect(page.getByText("Withdrawal announced.", { exact: false })).toBeVisible({ timeout: 40000 });
  expect(await c.getBalance(stranger)).toBe(0);
  const waiting = await vaultState(vault);
  expect(waiting.pending?.destination.toBase58()).toBe(stranger.toBase58());
  expect(waiting.pending!.opensAt - BigInt(Math.floor(Date.now() / 1000))).toBeGreaterThan(86_000n);
  await expect(page.getByText("LEAVES IN", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("tokens: deposit and withdraw a classic SPL token", async ({ page }, info) => {
  const { c, recipient, errors, payer, vaultState, build, unseal, deposit }: Ctx = await setup(page, info);
  const mint = await createMint(c, payer, payer.publicKey, null, 6);
  const walletToken = await getOrCreateAssociatedTokenAccount(c, payer, mint, payer.publicKey);
  await mintTo(c, payer, mint, walletToken.address, payer, 500_000_000);
  const { day0, vault } = await build(false);
  await unseal(day0);
  await expect(page.getByText("Unsealed", { exact: true })).toBeVisible({ timeout: 15000 });
  await deposit("0.5"); // SOL for the vault's own needs is not required; this exercises both assets.
  // Deposit 300 tokens.
  await page.getByRole("button", { name: "Deposit", exact: true }).click();
  await expect(page.getByLabel("Asset").locator("option")).toHaveCount(2);
  // Deposits are chosen by the wallet's token account, not by mint.
  await page.getByLabel("Asset").selectOption({ index: 1 });
  await page.getByLabel("Amount", { exact: true }).fill("300");
  await page.getByRole("button", { name: "Review deposit in wallet" }).click();
  await expect(page.getByText("Deposit confirmed.", { exact: true })).toBeVisible({ timeout: 25000 });
  await expect(page.locator(".token-rows")).toContainText("300");
  const vaultToken = await getAssociatedTokenAddress(mint, new PublicKey(vault), true);
  expect((await getAccount(c, vaultToken)).amount).toBe(300_000_000n);
  // Withdraw 120 to a recipient who has no token account yet.
  await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  await page.getByLabel("Asset").selectOption(mint.toBase58());
  await page.getByLabel("Amount", { exact: true }).fill("120");
  await page.getByLabel("Recipient wallet address").fill(recipient.publicKey.toBase58());
  await page.getByRole("button", { name: "Review withdrawal" }).click();
  await expect(page.getByText(mint.toBase58(), { exact: true })).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Sign and send" }).click();
  await expect(page.getByText("Withdrawal sent.", { exact: false })).toBeVisible({ timeout: 40000 });
  const recipientToken = await getAssociatedTokenAddress(mint, recipient.publicKey);
  expect((await getAccount(c, recipientToken)).amount).toBe(120_000_000n);
  expect((await getAccount(c, vaultToken)).amount).toBe(180_000_000n);
  await expect(page.locator(".token-rows")).toContainText("180");
  expect((await vaultState(vault)).opIndex).toBe(1n);
  // More than the Bunker holds is refused before anything is signed.
  await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  await page.getByLabel("Asset").selectOption(mint.toBase58());
  await page.getByLabel("Amount", { exact: true }).fill("181");
  await page.getByLabel("Recipient wallet address").fill(recipient.publicKey.toBase58());
  await page.getByRole("button", { name: "Review withdrawal" }).click();
  await expect(page.getByText("Enter an amount up to 180", { exact: false })).toBeVisible();
  expect((await vaultState(vault)).opIndex).toBe(1n);
  expect(errors).toEqual([]);
});

test("bunker mode: sweep the wallet in, then read the activity back", async ({ page }, info) => {
  const { c, recipient, errors, payer, build, unseal }: Ctx = await setup(page, info);
  const mint = await createMint(c, payer, payer.publicKey, null, 6);
  const walletToken = await getOrCreateAssociatedTokenAccount(c, payer, mint, payer.publicKey);
  await mintTo(c, payer, mint, walletToken.address, payer, 42_000_000);
  const { day0, vault } = await build(false);
  await unseal(day0);
  await expect(page.getByText("Unsealed", { exact: true })).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "Bunker Mode" }).click();
  await expect(page.getByLabel("Move SOL")).toBeChecked();
  await expect(page.locator(".sweep-list li")).toHaveCount(2);
  await page.getByRole("button", { name: "Move it all in" }).click();
  await expect(page.getByText("Bunker Mode on.", { exact: false })).toBeVisible({ timeout: 40000 });
  // The wallet keeps only its fee reserve; everything else is inside.
  expect(await c.getBalance(payer.publicKey)).toBe(20_000_000);
  const vaultToken = await getAssociatedTokenAddress(mint, new PublicKey(vault), true);
  expect((await getAccount(c, vaultToken)).amount).toBe(42_000_000n);
  expect((await getAccount(c, walletToken.address)).amount).toBe(0n);
  await expect(page.locator(".token-rows")).toContainText("42");
  // One withdrawal, then the activity log shows the whole story.
  await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  await page.getByLabel("Amount", { exact: true }).fill("1");
  await page.getByLabel("Recipient wallet address").fill(recipient.publicKey.toBase58());
  await page.getByRole("button", { name: "Review withdrawal" }).click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Sign and send" }).click();
  await expect(page.getByText("Withdrawal sent.", { exact: false })).toBeVisible({ timeout: 40000 });
  await page.getByRole("button", { name: "Show activity" }).click();
  const log = page.locator(".activity-log ul");
  await expect(log.locator("li")).toHaveCount(4, { timeout: 20000 });
  await expect(log.locator("li").nth(0)).toContainText("Withdrawal sent");
  await expect(log.locator("li").nth(0)).toContainText("−1 SOL");
  await expect(log.locator("li").nth(1)).toContainText("Deposit");
  await expect(log.locator("li").nth(2)).toContainText("+42");
  await expect(log.locator("li").nth(3)).toContainText("Bunker built");
  expect(errors).toEqual([]);
});

test("passkey: save a day key to the device and unseal with it", async ({ page }, info) => {
  // WebAuthn needs a registrable host name; an IP address cannot be an RP ID.
  const { c, recipient, errors, vaultState, build, unseal, deposit }: Ctx = await setup(page, info, "http://localhost:5173");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      hasPrf: true,
      automaticPresenceSimulation: true,
    },
  });
  const { day0, vault } = await build(false);
  await unseal(day0);
  await expect(page.getByText("Unsealed", { exact: true })).toBeVisible({ timeout: 15000 });
  await deposit("1");
  await page.getByRole("button", { name: "Unseal with a passkey next time" }).click();
  await expect(page.getByText("Saved. Next time", { exact: false })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("Unseals with passkey", { exact: true })).toBeVisible();
  // What is stored is ciphertext: neither the seed nor the word appears.
  const stored = await page.evaluate(() =>
    Object.entries(localStorage).filter(([k]) => k.startsWith("bunker3-passkey:")),
  );
  expect(stored).toHaveLength(1);
  expect(stored[0][1]).not.toContain("seed");
  const seed = JSON.parse(readFileSync(day0, "utf8")).ciphertext as string;
  expect(stored[0][1]).not.toContain(seed.slice(0, 32));
  // Seal, come back, and open with the passkey alone: no file, no password.
  await page.getByRole("button", { name: "Seal Bunker" }).click();
  await page.goto("http://localhost:5173/vault");
  await connect(page);
  // The cross-device statement is required however the key is opened.
  await expect(page.getByRole("button", { name: "Unseal with passkey" })).toBeDisabled();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Unseal with passkey" }).click();
  await expect(page.getByText("Unsealed with your passkey.", { exact: false })).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".vault-balance")).toContainText("1");
  // And it can sign: a withdrawal goes through.
  await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  await page.getByLabel("Amount", { exact: true }).fill("0.25");
  await page.getByLabel("Recipient wallet address").fill(recipient.publicKey.toBase58());
  await page.getByRole("button", { name: "Review withdrawal" }).click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Sign and send" }).click();
  await expect(page.getByText("Withdrawal sent.", { exact: false })).toBeVisible({ timeout: 40000 });
  expect(await c.getBalance(recipient.publicKey)).toBe(250_000_000);
  expect((await vaultState(vault)).opIndex).toBe(1n);
  // Tampered storage does not unlock.
  await page.getByRole("button", { name: "Seal Bunker" }).click();
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("bunker3-passkey:"))!;
    const r = JSON.parse(localStorage.getItem(key)!);
    r.ciphertext = (r.ciphertext[0] === "0" ? "1" : "0") + r.ciphertext.slice(1);
    localStorage.setItem(key, JSON.stringify(r));
  });
  await page.goto("http://localhost:5173/vault");
  await connect(page);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Unseal with passkey" }).click();
  await expect(page.getByText("did not unlock the saved day key", { exact: false })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("Sealed", { exact: true })).toBeVisible();
  // Removing it returns to the file path.
  await page.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByRole("button", { name: "Unseal with passkey" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("default, no waiting period: a withdrawal arrives on the third approval", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const { c, recipient, errors, vaultState, build, unseal, deposit, toolRequests, net }: Ctx = await setup(page, info);
  const { day0, vault } = await build(false);
  expect((await vaultState(vault)).delaySecs).toBe(0);
  await unseal(day0);
  await expect(page.getByText("Unsealed", { exact: true })).toBeVisible({ timeout: 15000 });
  await deposit("1");
  await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  await page.getByLabel("Amount", { exact: true }).fill("0.4");
  await page.getByLabel("Recipient wallet address").fill(recipient.publicKey.toBase58());
  await page.getByRole("button", { name: "Review withdrawal" }).click();
  await expect(page.getByText("Immediately, on the third approval.", { exact: false })).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Sign and send" }).click();
  await expect(page.getByText("Withdrawal sent.", { exact: false })).toBeVisible({ timeout: 40000 });
  expect(await c.getBalance(recipient.publicKey)).toBe(400_000_000);
  const state = await vaultState(vault);
  expect([state.epoch, state.opIndex, state.pending]).toEqual([0n, 1n, null]);
  await expect(page.getByText("LEAVES IN", { exact: true })).toHaveCount(0);
  await expect(page.locator(".vault-balance")).toContainText("0.6");
  // The next withdrawal uses the next key, with no recovery file to juggle.
  await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  await page.getByLabel("Amount", { exact: true }).fill("0.1");
  await page.getByLabel("Recipient wallet address").fill(recipient.publicKey.toBase58());
  await page.getByRole("button", { name: "Review withdrawal" }).click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Sign and send" }).click();
  await expect(page.getByText("Withdrawal sent.", { exact: false })).toBeVisible({ timeout: 40000 });
  expect(await c.getBalance(recipient.publicKey)).toBe(500_000_000);
  expect((await vaultState(vault)).opIndex).toBe(2n);
  // The final approval lands but the network never confirms it. The page must
  // not leave the user on a screen where pressing again pays a second time.
  await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  await page.getByLabel("Amount", { exact: true }).fill("0.2");
  await page.getByLabel("Recipient wallet address").fill(recipient.publicKey.toBase58());
  await page.getByRole("button", { name: "Review withdrawal" }).click();
  await page.getByRole("checkbox").check();
  net.sends = 0;
  net.loseFromSend = 3;
  await page.getByRole("button", { name: "Sign and send" }).click();
  await expect(page.getByText("Withdrawal sent.", { exact: false })).toBeVisible({ timeout: 40000 });
  net.loseFromSend = 0;
  await expect(page.getByRole("button", { name: "Sign and send" })).toHaveCount(0);
  await expect(page.getByText("Finish announcing", { exact: false })).toHaveCount(0);
  expect(await c.getBalance(recipient.publicKey)).toBe(700_000_000);
  expect((await vaultState(vault)).opIndex).toBe(3n);
  await expect(page.locator(".vault-balance")).toContainText("0.3");
  expect(toolRequests, "the offline tool made no network request").toEqual([]);
  expect(errors).toEqual([]);
});
