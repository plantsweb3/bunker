// The Bunker Watch popup, drawn from stored readings. The browser-extension
// APIs are replaced by a stand-in and the RPC endpoint by canned answers, so
// these cases show what the popup does with what the background pass stored,
// and that it asks the network for nothing but the RPC.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const POPUP = `file://${resolve("dist/bunker-watch/popup.html")}`;
const RPC = "https://api.mainnet-beta.solana.com/";
const MAINNET = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const A = "36VASLSKLFD2KokjXG7V28veZvXEsyHRKefLonPaAKzv";
const B = "3AQTaduKvYWFTu1ExZSQK1hQp5jSZ2yEt4KzsASAufKd";
const NOW = 1_800_000_000;
const view = (address: string, lamports: string, epoch: string, opIndex: string, pending: unknown = null) => ({
  address,
  lamports,
  epoch,
  opIndex,
  delaySecs: 86_400,
  pending,
  checkedAt: String(NOW),
});
const waiting = {
  kind: 0,
  mint: "11111111111111111111111111111111",
  destination: "3EKkiwNLWqoUbzFkPrmKbtUB4EweE6f4STzevYUmezeL",
  amount: "10000000000",
  opensAt: String(NOW + 85_267),
  deadline: String(NOW + 172_800),
  digest: "09".repeat(32),
  trusted: false,
};
// The popup under test is the built one. `npm run source:bundle` (or
// `npm run extension:build`) makes it, and CI runs that before these cases;
// it is built here only when it is missing, since the two browser projects
// run side by side and must not both write it.
test.beforeAll(() => {
  if (!existsSync("dist/bunker-watch/popup.html"))
    execFileSync(process.execPath, ["scripts/build-extension.mjs"], { stdio: "ignore" });
});

/** Opens the popup over `stored`, and returns what went wrong and what was asked of the network. */
async function open(page: Page, stored: Record<string, unknown>, answers: Record<string, unknown> = {}) {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = request.url();
    if (url.startsWith("file://")) return route.continue();
    requests.push(url);
    if (url !== RPC) return route.abort();
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const body = request.postDataJSON() as { id: unknown; method: string };
    if (!(body.method in answers)) return route.fulfill({ status: 500, headers: cors, body: `unexpected ${body.method}` });
    return route.fulfill({ status: 200, headers: cors, json: { jsonrpc: "2.0", id: body.id, result: answers[body.method] } });
  });
  await page.addInitScript(
    ({ stored, at }) => {
      // The popup's clock is the chain time of the last pass plus time since.
      const data: Record<string, unknown> = { status: { passAt: Date.now(), chainNow: String(at), problem: null, retryAt: 0, refusals: 0 }, ...stored };
      const pick = (keys: string[]) => Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]]));
      const changed: (() => void)[] = [];
      (window as unknown as { chrome: unknown }).chrome = {
        storage: {
          local: {
            get: async (keys: string[]) => pick(keys),
            set: async (items: Record<string, unknown>) => void (Object.assign(data, items), changed.forEach((f) => f())),
            remove: async (keys: string[]) => void keys.forEach((k) => delete data[k]),
          },
          onChanged: { addListener: (f: () => void) => changed.push(f) },
        },
        runtime: { sendMessage: async () => ({ ok: true }), getManifest: () => ({ version: "0.1.1" }) },
        permissions: { request: async () => true, remove: async () => true },
      };
    },
    { stored, at: NOW },
  );
  await page.setViewportSize({ width: 360, height: 600 });
  await page.goto(POPUP);
  await expect(page.locator(".ticker")).toContainText("PUBLIC BETA");
  await expect(page.locator(".ticker")).not.toContainText("UNAUDITED");
  return { errors, requests };
}
const quiet = {
  watched: [A, B],
  [`view:${A}`]: view(A, "12400000000", "1", "11"),
  [`view:${B}`]: view(B, "3050000000", "2", "4"),
};

test("first run: nothing watched, and it says what it is", async ({ page }, info) => {
  const seen = await open(page, {});
  await expect(page.getByRole("heading")).toHaveText("Nothing watched.Add your Bunker.");
  await expect(page.getByText("It holds no keys and cannot move anything.", { exact: false })).toBeVisible();
  await expect(page.getByText("Silence is not proof", { exact: false })).toBeVisible();
  await page.screenshot({ path: info.outputPath("watch-empty.png") });
  expect(seen).toEqual({ errors: [], requests: [] });
});
test("watching, all quiet", async ({ page }, info) => {
  const seen = await open(page, quiet);
  await expect(page.getByRole("heading")).toHaveText("All quiet.2 Bunkers watched.");
  const first = page.locator(`[data-bunker="${A}"]`);
  await expect(first).toContainText("Bunker 36VA…AKzv");
  await expect(first).toContainText("12.4");
  await expect(first).toContainText("epoch 1 · next 11");
  await expect(first).toContainText("No withdrawal waiting");
  await expect(page.locator(`[data-bunker="${B}"]`)).toContainText("epoch 2 · next 4");
  await page.screenshot({ path: info.outputPath("watch-quiet.png") });
  expect(seen).toEqual({ errors: [], requests: [] });
});
test("a withdrawal was announced: the cream card, and what to do", async ({ page }, info) => {
  const seen = await open(page, { ...quiet, [`view:${A}`]: view(A, "12400000000", "1", "12", waiting) });
  await expect(page.getByRole("heading")).toHaveText("Withdrawalannounced.");
  const card = page.locator(`[data-waiting="${A}"]`);
  await expect(card).toHaveCSS("background-color", "rgb(234, 231, 223)");
  await expect(card).toContainText("10 SOL");
  // The whole destination, not a shortened one.
  await expect(card).toContainText("3EKkiwNLWqoUbzFkPrmKbtUB4EweE6f4STzevYUmezeL");
  await expect(card).toContainText("Not a trusted address · it waits");
  await expect(card.locator("[data-countdown]")).toContainText(/^23:41:0\d/);
  await expect(page.getByRole("link", { name: "What to do now →" })).toHaveAttribute("href", "https://bunkermode.io/emergency");
  await expect(page.getByText("Bunker never asks for your recovery kit or its password.")).toBeVisible();
  await page.screenshot({ path: info.outputPath("watch-announced.png") });
  // Nothing on the page is red: urgency is in the words and the layout.
  expect(await page.evaluate(() => [...document.querySelectorAll("*")].some((e) => /rgb\((2[0-9]{2}), ([0-9]{1,2}), ([0-9]{1,2})\)/.test(getComputedStyle(e).color + getComputedStyle(e).backgroundColor)))).toBe(false);
  // Saying it was you puts the list back, with the withdrawal still shown as waiting.
  await page.getByRole("button", { name: "It was me" }).click();
  await expect(page.getByRole("heading")).toHaveText("Withdrawal waiting.2 Bunkers watched.");
  await expect(card).toBeVisible();
  expect(seen).toEqual({ errors: [], requests: [] });
});
test("it says so on every screen when it cannot see, and how old a reading is", async ({ page }) => {
  // The last reading was four hours ago, and nothing has been read since.
  const stale = view(A, "12400000000", "1", "12", waiting);
  await open(page, {
    ...quiet,
    [`view:${A}`]: stale,
    status: { passAt: Date.now() - 4 * 3_600_000, chainNow: String(NOW), problem: "The network could not be read.", retryAt: 0, refusals: 0, failingSince: Date.now() - 4 * 3_600_000, toldBlind: true },
  });
  await expect(page.getByRole("heading")).toHaveText("Withdrawalannounced.");
  await expect(page.getByRole("alert")).toContainText("has not been able to read the network");
  const card = page.locator(`[data-waiting="${A}"]`);
  await expect(card).toContainText("read 4h 0m ago");
  // The countdown keeps moving by this computer's clock: four hours have gone.
  await expect(card.locator("[data-countdown]")).toContainText(/^19:41:0\d/);
});
test("check a wallet: read-only, and only the RPC is asked", async ({ page }, info) => {
  const token = (mint: string, amount: string, delegate?: string) => ({
    pubkey: mint,
    account: {
      executable: false,
      lamports: 2_039_280,
      owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      rentEpoch: 0,
      space: 165,
      data: {
        program: "spl-token",
        space: 165,
        parsed: {
          type: "account",
          info: { mint, state: "initialized", tokenAmount: { amount, decimals: 6 }, ...(delegate ? { delegate, delegatedAmount: { amount } } : {}) },
        },
      },
    },
  });
  const seen = await open(page, quiet, {
    getGenesisHash: MAINNET,
    getBalance: { context: { slot: 1 }, value: 3_210_000_000 },
    getTokenAccountsByOwner: { context: { slot: 1 }, value: [token(A, "5000000", B), token(B, "7000000")] },
    getMultipleAccounts: { context: { slot: 1 }, value: [null, null] },
  });
  await page.getByRole("tab", { name: "Check a wallet" }).click();
  await expect(page.getByRole("heading")).toHaveText("Checka wallet.");
  await page.getByLabel("Wallet address").fill(waiting.destination);
  await page.getByRole("button", { name: "Check" }).click();
  const result = page.locator("[data-exposure]");
  await expect(result).toContainText("3.21");
  await expect(result).toContainText("open delegation");
  await expect(page.getByText("connects no wallet", { exact: false })).toBeVisible();
  await page.screenshot({ path: info.outputPath("watch-check.png") });
  expect(seen.errors).toEqual([]);
  expect([...new Set(seen.requests)]).toEqual([RPC]);
});
test("settings: an endpoint that is not mainnet is refused", async ({ page }) => {
  const seen = await open(page, quiet);
  // An endpoint that answers, and is devnet.
  await page.route("https://rpc.example/**", (route) => {
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const { id } = route.request().postDataJSON() as { id: unknown };
    return route.fulfill({ status: 200, headers: cors, json: { jsonrpc: "2.0", id, result: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" } });
  });
  await page.getByRole("tab", { name: "Settings" }).click();
  await expect(page.getByText("Keys held")).toBeVisible();
  await page.getByLabel("RPC endpoint").fill("http://rpc.example");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert")).toHaveText("Use an https RPC address.");
  await page.getByLabel("RPC endpoint").fill("https://rpc.example/key");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert")).toContainText("is not Solana mainnet");
  await expect(page.locator(".ph").first()).toContainText("default");
  // What was typed is still there to be corrected.
  await expect(page.getByLabel("RPC endpoint")).toHaveValue("https://rpc.example/key");
  expect(seen.errors).toEqual([]);
});
