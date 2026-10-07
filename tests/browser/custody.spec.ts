import { test, expect } from "@playwright/test";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { parseVault } from "../../sdk/protocol";
// This suite only talks to an isolated LOCAL validator. No user wallet is used.
test("create, verify backup, deposit, withdraw, rotate, and restore after reload", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const rpc = "http://127.0.0.1:19099";
  const c = new Connection(rpc, "confirmed");
  let genesis: string;
  try {
    genesis = await c.getGenesisHash();
  } catch {
    test.skip(
      true,
      "Start the isolated local validator for the custody browser test",
    );
    return;
  }
  if (
    [
      "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
      "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
    ].includes(genesis)
  )
    throw new Error("Custody browser test requires local validator");
  const program = "AhZPKQAwKeCJ47PVKz5QZmBwf1PE8BHcmcqsjvSdPaZ";
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
        programId: program,
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
  await page.exposeFunction("localTestSign", async (bytes: number[]) => {
    const tx = Transaction.from(Uint8Array.from(bytes));
    if (!tx.feePayer?.equals(payer.publicKey))
      throw new Error("Unexpected local fee payer");
    tx.partialSign(payer);
    return Array.from(tx.serialize());
  });
  await page.addInitScript(
    ({ address, publicKey }) => {
      const account = {
        address,
        publicKey: Uint8Array.from(publicKey),
        chains: ["solana:localnet"],
        features: ["solana:signTransaction"],
      };
      const listeners = new Set<(p: unknown) => void>();
      const wallet = {
        version: "1.0.0",
        name: "Bunker local test wallet",
        icon: "data:image/png;base64,iVBORw0KGgo=",
        chains: ["solana:localnet"],
        accounts: [account],
        features: {
          "standard:connect": {
            version: "1.0.0",
            connect: async () => ({ accounts: [account] }),
          },
          "standard:disconnect": {
            version: "1.0.0",
            disconnect: async () => {
              listeners.forEach((f) => f({ accounts: [] }));
            },
          },
          "standard:events": {
            version: "1.0.0",
            on: (_event: string, f: (p: unknown) => void) => {
              listeners.add(f);
              return () => listeners.delete(f);
            },
          },
          "solana:signTransaction": {
            version: "1.0.0",
            supportedTransactionVersions: new Set(["legacy", 0]),
            signTransaction: async ({
              transaction,
            }: {
              transaction: Uint8Array;
            }) => [
              {
                signedTransaction: Uint8Array.from(
                  await (
                    window as unknown as {
                      localTestSign: (b: number[]) => Promise<number[]>;
                    }
                  ).localTestSign(Array.from(transaction)),
                ),
              },
            ],
          },
        },
      };
      window.addEventListener("wallet-standard:app-ready", ((
        event: CustomEvent,
      ) => event.detail.register(wallet)) as EventListener);
    },
    {
      address: payer.publicKey.toBase58(),
      publicKey: Array.from(payer.publicKey.toBytes()),
    },
  );
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/vault");
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Bunker local test wallet Connect" })
    .click();
  await page
    .getByRole("button", { name: "Create Bunker", exact: true })
    .click();
  const password = "local integration test password 2026";
  await page.getByLabel("Recovery password", { exact: true }).fill(password);
  await page
    .getByLabel("Confirm recovery password", { exact: true })
    .fill(password);
  await page.getByRole("checkbox").check();
  const initialDownloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Generate & save recovery kit" })
    .click();
  const initialDownload = await initialDownloadPromise;
  const initialFile = info.outputPath("initial-test-recovery.json");
  await initialDownload.saveAs(initialFile);
  await page
    .getByLabel("Verify saved recovery file")
    .setInputFiles(initialFile);
  await page
    .getByRole("button", { name: "Create Bunker on test network" })
    .click();
  await expect(page.getByText("Bunker created.", { exact: false })).toBeVisible(
    { timeout: 25000 },
  );
  const vaultText = await page.locator(".vault-address code").innerText();
  await page.getByRole("button", { name: "Deposit", exact: true }).click();
  await page.getByLabel("Amount", { exact: true }).fill("0.25");
  await page.getByRole("button", { name: "Review deposit in wallet" }).click();
  await expect(
    page.getByText("Deposit confirmed on the test network.", { exact: true }),
  ).toBeVisible({ timeout: 25000 });
  await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  await page.getByLabel("Amount", { exact: true }).fill("0.1");
  await page
    .getByLabel("Recipient wallet address")
    .fill(recipient.publicKey.toBase58());
  await page.getByLabel("Recovery password", { exact: true }).fill(password);
  await page.getByRole("checkbox").check();
  const pendingDownloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Save withdrawal recovery file" })
    .click();
  const pendingDownload = await pendingDownloadPromise;
  const pendingFile = info.outputPath("pending-test-recovery.json");
  await pendingDownload.saveAs(pendingFile);
  await page
    .getByLabel("Verify saved recovery file")
    .setInputFiles(pendingFile);
  await page
    .getByRole("button", { name: "Publish & complete withdrawal" })
    .click();
  await expect(
    page.getByText("Withdrawal confirmed and authority rotated.", {
      exact: false,
    }),
  ).toBeVisible({ timeout: 30000 });
  expect(await c.getBalance(recipient.publicKey)).toBe(100_000_000);
  expect(
    parseVault((await c.getAccountInfo(new PublicKey(vaultText)))!.data).nonce,
  ).toBe(1n);
  await page.reload();
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Bunker local test wallet Connect" })
    .click();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await page
    .getByLabel("Encrypted recovery file", { exact: true })
    .setInputFiles(initialFile);
  await page.getByLabel("Recovery password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Unlock recovery file" }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByText("This recovery file is stale.", { exact: false }),
  ).toBeVisible();
  await page
    .getByLabel("Encrypted recovery file", { exact: true })
    .setInputFiles(pendingFile);
  await page.getByRole("button", { name: "Unlock recovery file" }).click();
  await expect(
    page.getByText("Bunker restored.", { exact: false }),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".vault-balance")).toContainText("0.15");
  expect(errors).toEqual([]);
});
