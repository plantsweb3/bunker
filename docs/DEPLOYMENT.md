# Deployment

## Public website

The public project is `bunker` on Vercel, connected to `plantsweb3/bunker`, with the canonical domain **https://bunkermode.io**. The `www` hostname redirects to the apex. GitHub is the source of record; `main` is the production branch. `vercel.json` builds the source-download archive and native Next.js application. Use Node 22 and the committed npm lockfile.

The public release uses Solana mainnet and the one program address in `lib/bunker-config.ts`. No deployment signer, wallet secret, or seed is required to build or publish it. Do not set any `BUNKER_TEST_*`, `BUNKER_LOCAL_GENESIS`, or `BUNKER_ENABLE_TEST_CUSTODY` variables in Vercel production. No environment variable can point the site, the offline tool or the command-line client at a different mainnet program.

Set `SOLANA_RPC_URL` as a **sensitive, server-only** Vercel production environment variable; reads and submitted transactions both go through it. Never prefix it with `NEXT_PUBLIC_`. The default is Solana's public mainnet RPC, which may be unavailable or rate limited. Redeploy after changing environment variables. Do not paste provider keys into issues, commits, or browser code.

The RPC route uses a fixed configured endpoint, a method allowlist, origin checks, streaming byte limits, deadlines, and pinned genesis verification before any write. Origin checks are not authentication. The route forwards any well-formed transaction for simulation or sending, not only Bunker’s: it limits each client to 40 a minute, which blunts misuse of the provider quota and does not prevent it. Before allocating a paid RPC quota, configure provider spending limits and an edge rate limit for `/api/rpc`; an in-memory limiter on a serverless instance is not a global quota. The frontend contains no analytics or third-party scripts. A per-request nonce authorizes scripts through Content Security Policy. Inline styles remain permitted for UI components.

## Telegram alerts (optional)

Off unless all six variables are set, and off whenever no program is configured. Set them as sensitive, server-only variables:

| Variable | What |
|---|---|
| `TELEGRAM_BOT_TOKEN` | From @BotFather |
| `TELEGRAM_BOT_USERNAME` | The bot's username, without `@` |
| `TELEGRAM_WEBHOOK_SECRET` | 24+ random characters; Telegram sends it with every update |
| `CRON_SECRET` | 24+ random characters; the scheduler sends it as a bearer token |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | An Upstash Redis REST endpoint (the Vercel Marketplace integration sets these) |

Then run `scripts/telegram-setup.mjs` once with the token and webhook secret in the environment to point the bot at `/api/telegram`. The scheduler entry is in `vercel.json`. Rotating the webhook secret means running the script again.

## Reproduce and deploy

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run source:bundle
npm run build
npm start
```

Use the existing Vercel project linked to this repository. Review the deployment's commit SHA and build logs, then confirm `/api/config` reports the published program address, `/api/verify` reports the deployment and its upgrade authority as read from the chain, and `/api/rpc` refuses methods the app never calls. Test both the canonical hostname and the `www` redirect over HTTPS. Vercel generates the downloadable source bundle at build time; its SHA-256 manifest checks integrity, not independent authorship or reproducibility of an on-chain binary.

Roll back the website through the Vercel deployment dashboard to a previously checked release. A website rollback cannot undo a transaction or restore a consumed one-time key. Do not roll the site back to a release that predates the mainnet program without saying so publicly: holders would lose the interface, though not the command-line client.

## Isolated program testing

The local validator loads `target/deploy/bunker3.so` at a fixed **test-only** address and needs no program private key. `scripts/setup-local.ts` checks the program is present and pins the local genesis hash before creating the ignored `.env.local`. Restart the local app after changing that file; remove it to restore the mainnet read-only configuration. Use a new `BUNKER_LOCAL_LEDGER` directory after rebuilding the program: an existing ledger keeps its old binary.

Before any test deployment elsewhere, run the workspace Rust tests, regenerate and compare `fixtures/bunker-v3.json`, build the program, run the VM suite, the chain cycles and the browser custody cases, and record the binary's SHA-256. There is no devnet deployment and no tooling for one in this repository. Adding an environment setting that changes the mainnet program is prohibited.

## The mainnet program

Deployed 2026-10-09 as a public beta, before any audit. CertiK then audited the program and its signature verifier at commit `f6a37ce` and published its report on 2026-10-20 (https://skynet.certik.com/projects/bunker-mode). Upgraded 2026-10-19 to commit `9bb0856`: the program code of commit `f6a37ce` plus one change, which refuses a withdrawal announcement the vault cannot pay (refusal code 126). That change is the fix for the audit's one code finding.

| | |
|---|---|
| Program | `DGXACBwbUqRKRVR1TQojZBoRuV2TZJ8wVnQSuLKm2nJJ` |
| Program data | `Ga1huSvpvaKFg7jiZnRoL89154MbypVdgBQ516UkCV1k` |
| Built from | commit `9bb08566514b7107f5d226cbf8e591da22092786`, `solana-verify build --library-name bunker3` (solana-verify 0.5.2, Solana 4.3.0) |
| Executable hash | `161e6b4caac746dc35115910c2b4d50fe319b97d5a3a4ec39f9b6350adf14518` |
| Upgrade transaction | `2MS6LVHbKJ99S7TnbC1qzbeB8hN9i62vDeEuf2wK7D5jikov5wkgkKW4eey7wAgEiVQTnFGJQVTHnFSLBAWk9hTr` (2026-10-19) |
| First deployment | `2A9ztQPhJCG5VUCf3NwJG9gG8d6nek4rJbtMieuRDEZWVPDSU2VaX6Fzmhmc3hEYMKDsF6MJhEoDizVjpGCWTEhj` (2026-10-09, commit `2182e5f`, executable hash `a7f39161…f08f7`) |
| Upgrade authority | None (renounced 2026-10-19, transaction `5JMmTMa7KCtmjxNUzqDJv1CyCna3QzNiNHsMd1ir4PXWFR4KZV4UqiugA4VfPQhsiVeThaTJxnRbnzFBFZZ1KtAA`) |

The upgrade authority has recorded this commit on chain (with the build image, because the public verifier does not yet choose one for Solana 4.3.0), and the public verified-builds service rebuilt it and reports a match: https://verify.osec.io/status/DGXACBwbUqRKRVR1TQojZBoRuV2TZJ8wVnQSuLKm2nJJ. The same hash was produced twice in the pinned container for that commit, and the upgrade checked the uploaded copy against it before it was swapped in; the program's VM suite and the local-validator suites were run against that code before the upgrade. `npm run check:deployment -- --rpc <url> --program <address> --binary <file>` reads the program from the network and compares; it reports that the code matches and that upgrades are possible.

## Upgrade authority

**The program is permanent.** Its upgrade authority has been renounced: the program-data account names none, and no key, including the maintainer's, can replace the program. It was deployed from a throwaway key, the authority was moved to a hardware wallet, used once to deploy the fixes from the independent review, and then renounced.

This removes the largest trust a holder had to extend: that one key could change any rule, including who may withdraw. The cost is the reverse. A flaw found from now on cannot be fixed in place; the answer would be a new program, and holders moving their assets to it, which only works while withdrawals still do. A matching executable hash now describes the program for good.

The program has no administrator role over any vault and cannot be paused. A problem is met by stopping new deposits in the interface and by holders withdrawing; the command-line client exists so that does not depend on this website.

A website rollback cannot undo a transaction.

## What has not been done

The preconditions in [LAUNCH-RUNBOOK.md](LAUNCH-RUNBOOK.md) step 0 were not met before launch: no completed independent cryptographic review or program audit (CertiK's audit of the program has since been completed), no completed [REVIEW-CHECKLIST.md](REVIEW-CHECKLIST.md), no legal review of the terms, and no run of the whole flow on real phones and in wallet apps' browsers. A bug bounty is open (`/bounty`, terms in `lib/bounty.ts`); its payout amounts are not set. These remain the work that would justify removing the word "unaudited" anywhere.
