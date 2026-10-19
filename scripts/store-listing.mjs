// Draws the pictures for the Chrome Web Store listing of Bunker Watch, from
// the built extension itself: the real popup, over stored readings that are
// made up and labelled SIMULATION.
//
//   npm run extension:build && node scripts/store-listing.mjs
//   writes docs/store-listing/*.png
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const out = "docs/store-listing";
const ext = `file://${resolve("dist/bunker-watch")}`;
const still = `file://${resolve("public/assets/kit/clips/datacenter-city-flyover-poster.jpg")}`;
const tile = `file://${resolve("public/assets/kit/design/halftone-tile-dark.png")}`;
const NOW = 1_800_000_000;
const A = "36VASLSKLFD2KokjXG7V28veZvXEsyHRKefLonPaAKzv";
const B = "3AQTaduKvYWFTu1ExZSQK1hQp5jSZ2yEt4KzsASAufKd";
const C = "3EKkiwNLWqoUbzFkPrmKbtUB4EweE6f4STzevYUmezeL";
const view = (address, lamports, epoch, opIndex, pending = null) => ({ address, lamports, epoch, opIndex, delaySecs: 86_400, pending, checkedAt: String(NOW) });
const waiting = { kind: 0, mint: "11111111111111111111111111111111", destination: C, amount: "10000000000", opensAt: String(NOW + 85_267), deadline: String(NOW + 172_800), digest: "09".repeat(32), trusted: false };
const quiet = { watched: [A, B], [`view:${A}`]: view(A, "12400000000", "1", "11"), [`view:${B}`]: view(B, "3050000000", "2", "4") };
const css = `
@font-face { font-family: "Inter"; src: url("${ext}/fonts/inter-latin-800-normal.woff2"); font-weight: 800; }
@font-face { font-family: "Space Grotesk"; src: url("${ext}/fonts/space-grotesk-latin-500-normal.woff2"); font-weight: 500; }
@font-face { font-family: "JetBrains Mono"; src: url("${ext}/fonts/JetBrainsMono-wght.ttf"); font-weight: 100 800; }
* { margin: 0; box-sizing: border-box; }
body { background: #080B0E; color: #F0F3F2; font: 500 20px/1.45 "Space Grotesk"; overflow: hidden; }
.big { font: 800 78px/0.98 "Inter"; letter-spacing: -0.03em; text-transform: uppercase; }
.big span { display: block; color: #A9DEFF; }
.mono { font: 700 14px "JetBrains Mono"; letter-spacing: 0.06em; text-transform: uppercase; }
.chip { display: inline-block; padding: 7px 10px; }
.sim { border: 1px dashed rgba(169,222,255,.6); color: #A9DEFF; }
.status { color: #7192A5; }`;
const shot = (headline, second, line) => `<!doctype html><meta charset="utf-8"><style>${css}
body { width: 1280px; height: 800px; display: grid; grid-template-columns: 1fr 360px; gap: 80px; align-items: center; padding: 0 110px 0 100px; }
p { color: #b9c7cf; margin: 26px 0 34px; max-width: 520px; }
iframe { width: 360px; height: 600px; border: 1px solid #1b2329; box-shadow: 0 0 0 8px #0b0f12; }
.row { display: flex; gap: 12px; align-items: center; }</style>
<div><div class="big">${headline}<span>${second}</span></div><p>${line}</p>
<div class="row"><span class="mono chip sim">Simulation</span><span class="mono status">Public beta · read-only: holds no keys</span></div></div>
<iframe src="${ext}/popup.html"></iframe>`;
const promo = (w, h, size) => `<!doctype html><meta charset="utf-8"><style>${css}
body { width: ${w}px; height: ${h}px; position: relative; }
.bg { position: absolute; inset: 0; background: url("${still}") center/cover; }
.shade { position: absolute; inset: 0; background: linear-gradient(90deg, #080b0ef2 0%, #080b0ecc 50%, #080b0e59 100%); }
.tile { position: absolute; inset: 0; background: url("${tile}"); background-size: 42px; opacity: .3; mix-blend-mode: multiply; }
.in { position: absolute; inset: 0; padding: ${Math.round(h * 0.13)}px ${Math.round(w * 0.07)}px; display: flex; flex-direction: column; justify-content: space-between; }
.big { font-size: ${size}px; } .mono { font-size: ${Math.max(10, Math.round(size / 5.4))}px; }</style>
<div class="bg"></div><div class="shade"></div><div class="tile"></div>
<div class="in"><div class="mono">Bunker · Watch</div><div class="big">Watch<span>your Bunker.</span></div><div class="mono status">Public beta · read-only: holds no keys</div></div>`;

const browser = await chromium.launch();
await mkdir(out, { recursive: true });
async function draw(name, html, width, height, stored, after) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.route("https://api.mainnet-beta.solana.com/**", async (route) => {
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const body = route.request().postDataJSON();
    const token = (mint, amount, delegate) => ({ pubkey: mint, account: { executable: false, lamports: 2039280, owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", rentEpoch: 0, space: 165, data: { program: "spl-token", space: 165, parsed: { type: "account", info: { mint, state: "initialized", tokenAmount: { amount, decimals: 6 }, ...(delegate ? { delegate, delegatedAmount: { amount } } : {}) } } } } });
    const answers = {
      getGenesisHash: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
      getBalance: { context: { slot: 1 }, value: 3_210_000_000 },
      getTokenAccountsByOwner: { context: { slot: 1 }, value: [token(A, "5000000", B), token(B, "7000000")] },
      getMultipleAccounts: { context: { slot: 1 }, value: [null, null] },
    };
    return route.fulfill({ status: 200, headers: cors, json: { jsonrpc: "2.0", id: body.id, result: answers[body.method] } });
  });
  await page.addInitScript(
    ({ stored, at }) => {
      const data = { status: { passAt: Date.now(), chainNow: String(at), problem: null, retryAt: 0, refusals: 0 }, ...stored };
      window.chrome = {
        storage: { local: { get: async (keys) => Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]])), set: async (items) => void Object.assign(data, items), remove: async () => {} }, onChanged: { addListener() {} } },
        runtime: { sendMessage: async () => ({ ok: true }), getManifest: () => ({ version: "0.1.1" }) },
        permissions: { request: async () => true, remove: async () => true },
      };
    },
    { stored: stored ?? {}, at: NOW },
  );
  const file = resolve(out, `.${name}.html`);
  await writeFile(file, html);
  await page.goto(`file://${file}`);
  await page.evaluate(() => document.fonts.ready);
  if (after) await after(page.frameLocator("iframe"));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${name}.png` });
  await page.close();
  (await import("node:fs")).rmSync(file);
}
await draw("screenshot-1-all-quiet", shot("Watch", "your Bunker.", "Checks up to five Bunkers once a minute, from your own browser. No account and no server of ours."), 1280, 800, quiet);
await draw("screenshot-2-withdrawal-announced", shot("Know", "in a minute.", "A desktop alert when a withdrawal is announced, with the amount, the whole destination and the time left to cancel it."), 1280, 800, { ...quiet, [`view:${A}`]: view(A, "12400000000", "1", "12", waiting) });
await draw("screenshot-3-check-a-wallet", shot("Check", "any wallet.", "See what one signature could move from a wallet, and who can already move it. Connects no wallet. Stores nothing."), 1280, 800, quiet, async (popup) => {
  await popup.getByRole("tab", { name: "Check a wallet" }).click();
  await popup.getByLabel("Wallet address").fill(C);
  await popup.getByRole("button", { name: "Check" }).click();
  await popup.locator("[data-exposure]").waitFor();
});
await draw("screenshot-4-read-only", shot("Reads.", "Moves nothing.", "Holds no keys and cannot send a transaction. Bunker never asks for your recovery kit or its password."), 1280, 800, quiet, async (popup) => {
  await popup.getByRole("tab", { name: "Settings" }).click();
});
await draw("promo-small-440x280", promo(440, 280, 54), 440, 280);
await draw("promo-marquee-1400x560", promo(1400, 560, 132), 1400, 560);
await browser.close();
console.log(`Store listing pictures written to ${out}/`);
