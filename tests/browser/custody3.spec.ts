import { test, expect, Page, TestInfo } from "@playwright/test";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { parseVault } from "../../sdk/v3/protocol";
import { connect, installLocalWallet } from "./local-wallet";
// Protocol 3 draft against an isolated LOCAL validator. No user wallet is used.
// The 24-hour wait cannot elapse here; release after the wait is covered by the
// in-process VM suite in programs/bunker3-svm-tests.
const PROGRAM = "k7FaK87WHGVXzkaoHb7CdVPgkKDQhZ29VLDeBVbDfYn";
type Ctx = Awaited<ReturnType<typeof setup>>;
async function setup(page: Page, info: TestInfo) {
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


  /** Builds a Bunker in the recovery tool. `wait` opts into a 24-hour waiting period. */
  const build = async (wait: boolean) => {
    await page.goto("/recovery");
    await connect(page);
    await page.getByLabel("Recovery password", { exact: true }).fill(password);
    await page.getByLabel("Confirm recovery password", { exact: true }).fill(password);
    await page.getByLabel("Acknowledge the recovery kit").check();
    const create = page.getByRole("button", { name: "Create recovery kit" });
    // The waiting period is off unless turned on AND acknowledged.
    await expect(page.getByLabel("Add a waiting period")).not.toBeChecked();
    if (wait) {
      await page.getByLabel("Add a waiting period").check();
      await expect(create).toBeDisabled();
      await expect(page.getByLabel("Waiting period", { exact: true })).toHaveValue("86400");
      await page.getByLabel("Acknowledge the waiting period").check();
    }
    const kit = await save(() => create.click(), "recovery-kit.json");
    await page.getByLabel("Re-open the saved recovery kit").setInputFiles(kit);
    await expect(page.getByText("Verified:", { exact: false })).toBeVisible();
    const day0 = await save(
      () => page.getByRole("button", { name: "Build Bunker on test network" }).click(),
      "day-key-0.json",
    );
    await expect(page.getByText("Bunker built.", { exact: false })).toBeVisible({ timeout: 25000 });
    const vault = await page.locator(".vault-address code").innerText();
    return { kit, day0, vault };
  };
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
  const deposit = async (amount: string) => {
    await page.getByRole("button", { name: "Deposit", exact: true }).click();
    await page.getByLabel("Amount", { exact: true }).fill(amount);
    await page.getByRole("button", { name: "Review deposit in wallet" }).click();
    await expect(page.getByText("Deposit confirmed.", { exact: true })).toBeVisible({ timeout: 25000 });
  };
  return { c, recipient, errors, password, save, vaultState, build, unseal, deposit };
}
test("with a waiting period: announce, count down, cancel by recovery, continue with new keys", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const { c, recipient, errors, password, save, vaultState, build, unseal, deposit }: Ctx = await setup(page, info);
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

test("default, no waiting period: a withdrawal arrives on the third approval", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const { c, recipient, errors, vaultState, build, unseal, deposit }: Ctx = await setup(page, info);
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
  expect(errors).toEqual([]);
});
