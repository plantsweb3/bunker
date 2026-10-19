# Chrome Web Store listing for Bunker Watch

Everything the store's forms ask for, written out so that what is submitted is what was reviewed here. The pictures in this folder are drawn by `npm run extension:listing` from the built extension; their numbers are made up and labelled SIMULATION.

The listing is published as item `hdolgpohfdllibcmceaenliegnedeafn`: https://chromewebstore.google.com/detail/bunker-watch/hdolgpohfdllibcmceaenliegnedeafn. `extension/store.json` holds that ID, and `/watch` and `/verify` link to it.

## What to upload

`public/source/bunker-watch.zip` built from the commit on `main` that the site is serving (`npm ci && npm run extension:build`). Its SHA-256 must equal the one on https://bunkermode.io/verify before it is uploaded.

## Store listing

**Name:** Bunker Watch

**Summary** (132 characters at most):
Get a desktop alert when a withdrawal is announced from your Bunker. Read-only: holds no keys.

**Category:** Privacy & Security. **Language:** English.

**Description:**

Get a desktop alert when a withdrawal is announced from your Bunker. Read-only: holds no keys.

PUBLIC BETA · READ-ONLY

Bunker is an open-source vault for Solana. A withdrawal to an address you did not list as trusted waits before it can leave, and you can cancel it while it waits. That only helps if you find out in time. Bunker Watch does the finding out, in your own browser.

What it does
- Watches up to five Bunkers. You paste an address; it checks that the address is a Bunker.
- Reads each one once a minute and compares it with the minute before.
- When a withdrawal is announced: a desktop notification with the amount and the whole destination address, the hours left on the toolbar badge, and a countdown in the popup.
- Also tells you when SOL arrives, when a withdrawal leaves, and when a Bunker's keys are replaced.
- Checks any wallet: what one signature could move, and who can already move it.

What it does not do
- It holds no keys and cannot send a transaction. It never asks for a key, a seed phrase, a recovery kit or a password. Bunker never does.
- It does not withdraw, cancel or recover. For those it links to bunkermode.io.
- It runs only while your browser is running.
- Alerts are best effort and can be late or missing. Silence is not proof that nothing happened. If it cannot read the network for five minutes, it tells you.
- It believes the Solana RPC endpoint it talks to.

Open source and verifiable
Source: https://github.com/plantsweb3/bunker (the extension is in /extension)
The published build and its SHA-256: https://bunkermode.io/verify
How it works and its limits: https://bunkermode.io/watch

Bunker protects the withdrawal path, not the chain. Its on-chain program is being audited by CertiK.

**Pictures:** `screenshot-1-all-quiet.png` to `screenshot-4-read-only.png` (1280 x 800), `promo-small-440x280.png`, `promo-marquee-1400x560.png`. Store icon: `store-icon-128.png` (96 x 96 of artwork inside 128 x 128, on a dark tile so it shows on the store's white page).

**Official URL:** bunkermode.io (verify the domain in the developer dashboard). **Homepage URL:** https://bunkermode.io/watch. **Support URL:** https://github.com/plantsweb3/bunker/issues

## Privacy practices tab

**Single purpose:**
Watch the public state of Solana vault accounts the user chooses and notify the user when it changes.

**Permission justifications:**

| Permission | Why |
|---|---|
| `storage` | To remember, in the browser only, which accounts the user watches, their last public state, recent alerts and the RPC setting. |
| `alarms` | To wake once a minute and read the watched accounts. |
| `notifications` | To show a desktop alert when a withdrawal is announced or another watched change happens. |
| Host permission `https://api.mainnet-beta.solana.com/*` | The public Solana RPC endpoint the extension reads account data from. |
| Optional host permission `https://*/*` | So a user can choose their own Solana RPC endpoint instead of the public one. Nothing is granted at install. The extension requests one origin, the one the user typed, when they save it, and gives up an origin that is refused or no longer used. No content scripts are injected and no page is read. |

**Remote code:** No. All code is in the package. The page policy is `default-src 'none'` with only the extension's own scripts.

**Data usage:** the extension does not collect or transmit any of the listed categories of user data. It has no server. The addresses a user watches are sent only to the Solana RPC endpoint the user uses, as queries for public account data. Tick all three certifications (no sale, no unrelated use, no creditworthiness use).

**Privacy policy URL:** https://bunkermode.io/privacy#extension

## Distribution

Public, all regions, free. No in-app purchases.

## Account

- The developer account's email must have 2-step verification on before publishing.
- After the first upload the dashboard shows the item ID (32 letters). Put it in `extension/store.json`, merge, and check that `/verify` shows it, before telling anyone the listing exists.
- The store repackages the zip, so an installed copy is compared with the per-file hashes in `extension-manifest.json`, not the zip's hash.

## Words that must not appear in the listing

Audited (until the report is published), safe, secure as a guarantee, unhackable, quantum-proof, guaranteed, insured, any price, market figure, token ticker or link to buy.
