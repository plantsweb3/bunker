import { test, expect } from "@playwright/test";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { parseVault } from "../../sdk/v3/protocol";
import { connect, installLocalWallet } from "./local-wallet";
// Protocol 3 draft against an isolated LOCAL validator. No user wallet is used.
// The 24-hour wait cannot elapse here; release after the wait is covered by the
// in-process VM suite in programs/bunker3-svm-tests.
const PROGRAM = "k7FaK87WHGVXzkaoHb7CdVPgkKDQhZ29VLDeBVbDfYn";
test("build, deposit, announce, cancel by recovery, and continue with new keys", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const rpc = "http://127.0.0.1:19099";
  const c = new Connection(rpc, "confirmed");
  let genesis: string;
  try {
    genesis = await c.getGenesisHash();
    if (!(await c.getAccountInfo(new PublicKey(PROGRAM)))?.executable) throw new Error();
  } catch {
    test.skip(true, "Start the local validator with the protocol 3 draft program built");
    return;
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
        protocolVersion: 3,
        expectedGenesis: genesis,
        releaseStatus: "Isolated local testing",
      },
    }),
  );
  await page.route("**/api/rpc", async (route) => {
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
  const save = async (trigger: () => Promise<void>, name: string) => {
    const download = page.waitForEvent("download");
    await trigger();
    const path = info.outputPath(name);
    await (await download).saveAs(path);
    return path;
  };
  const vaultState = async (address: string) =>
    parseVault((await c.getAccountInfo(new PublicKey(address)))!.data);

  // 1. Build a Bunker in the recovery tool.
  await page.goto("/recovery");
  await connect(page);
  await page.getByLabel("Recovery password", { exact: true }).fill(password);
  await page.getByLabel("Confirm recovery password", { exact: true }).fill(password);
  await page.getByRole("checkbox").check();
  const kit = await save(
    () => page.getByRole("button", { name: "Create recovery kit" }).click(),
    "recovery-kit.json",
  );
  await page.getByLabel("Re-open the saved recovery kit").setInputFiles(kit);
  await expect(page.getByText("Verified:", { exact: false })).toBeVisible();
  const day0 = await save(
    () => page.getByRole("button", { name: "Build Bunker on test network" }).click(),
    "day-key-0.json",
  );
  await expect(page.getByText("Bunker built.", { exact: false })).toBeVisible({ timeout: 25000 });
  const vault = await page.locator(".vault-address code").innerText();
  expect((await vaultState(vault)).delaySecs).toBe(86_400);

  // 2. Open it with the day key and deposit.
  const unseal = async (dayKey: string) => {
    await page.goto("/vault");
    await connect(page);
    await expect(page.getByText("Sealed", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Open with day key" }).click();
    await page.getByLabel("Day key", { exact: true }).setInputFiles(dayKey);
    await page.getByLabel("Day key password", { exact: true }).fill(password);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Unseal Bunker" }).click();
  };
  await unseal(day0);
  await expect(page.getByText("Unsealed", { exact: true })).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "Deposit", exact: true }).click();
  await page.getByLabel("Amount", { exact: true }).fill("1");
  await page.getByRole("button", { name: "Review deposit in wallet" }).click();
  await expect(page.getByText("Deposit confirmed.", { exact: true })).toBeVisible({ timeout: 25000 });
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

  // 4. Cancel it with the recovery kit. New keys, nothing moved.
  await page.goto("/recovery");
  await connect(page);
  await page.getByRole("tab", { name: "Recover or cancel" }).click();
  await page.getByLabel("Recovery kit", { exact: true }).setInputFiles(kit);
  await page.getByLabel("Recovery password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Open recovery kit" }).click();
  await expect(page.getByText("will be cancelled", { exact: false })).toBeVisible({ timeout: 15000 });
  const day1 = await save(
    () => page.getByRole("button", { name: "Cancel withdrawal and install new keys" }).click(),
    "day-key-1.json",
  );
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
  expect(errors).toEqual([]);
});
