# Deployment

## Public website

The public project is `bunker` on Vercel, connected to `plantsweb3/bunker`, with the canonical domain **https://bunkermode.io**. The `www` hostname redirects to the apex. GitHub is the source of record; `main` is the production branch. `vercel.json` builds the source-download archive and native Next.js application. Use Node 22 and the committed npm lockfile.

The public release uses Solana mainnet and the one program address in `lib/bunker-config.ts`. No deployment signer, wallet secret, or seed is required to build or publish it. Do not set any `BUNKER_TEST_*`, `BUNKER_LOCAL_GENESIS`, or `BUNKER_ENABLE_TEST_CUSTODY` variables in Vercel production. No environment variable can point the site, the offline tool or the command-line client at a different mainnet program.

Set `SOLANA_RPC_URL` as a **sensitive, server-only** Vercel production environment variable; reads and submitted transactions both go through it. Never prefix it with `NEXT_PUBLIC_`. The default is Solana's public mainnet RPC, which may be unavailable or rate limited. Redeploy after changing environment variables. Do not paste provider keys into issues, commits, or browser code.

The RPC route uses a fixed configured endpoint, a method allowlist, origin checks, streaming byte limits, deadlines, and pinned genesis verification before any write. Origin checks are not authentication. Before allocating a paid RPC quota, configure provider spending limits and an edge rate limit for `/api/rpc`; an in-memory limiter on a serverless instance is not a global quota. The frontend contains no analytics or third-party scripts. A per-request nonce authorizes scripts through Content Security Policy. Inline styles remain permitted for UI components.

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

Deployed 2026-10-09 as a public beta. Nothing here has been audited.

| | |
|---|---|
| Program | `DGXACBwbUqRKRVR1TQojZBoRuV2TZJ8wVnQSuLKm2nJJ` |
| Program data | `Ga1huSvpvaKFg7jiZnRoL89154MbypVdgBQ516UkCV1k` |
| Built from | commit `2182e5f`, `solana-verify build --library-name bunker3` (solana-verify 0.5.2, Solana 4.3.0) |
| Executable hash | `a7f39161fd812132e1e43a9a942cbda6b2fcc62bbc8235b0bca72f9bafbf08f7` |
| Deployment transaction | `2A9ztQPhJCG5VUCf3NwJG9gG8d6nek4rJbtMieuRDEZWVPDSU2VaX6Fzmhmc3hEYMKDsF6MJhEoDizVjpGCWTEhj` |
| Upgrade authority | `Ci5cG8d6MvU5ykKkQhN3LHnPN2VCmwZuotRNLqA9SYth` |

The same hash was produced by the `verified-build` job in CI for that commit, twice, and by a container build on a second machine; the program's VM suite was run against that binary before it was deployed. `npm run check:deployment -- --rpc <url> --program <address> --binary <file>` reads the program from the network and compares; it reports that the code matches and that upgrades are possible.

## Upgrade authority

**The program is upgradeable.** One key can replace it: the address above, held by the maintainer on a hardware wallet. It was deployed from a throwaway key and the authority was moved to the hardware wallet in the next transaction.

This is a deliberate choice for an unaudited beta, and it has a cost. A flaw found after launch can be fixed in place instead of by asking every holder to withdraw. In exchange, every vault is only as safe as that one key and the person holding it: an upgrade can change any rule, including who may withdraw. That is the kind of key this product exists to get away from, and holders should weigh it. A matching executable hash describes the code today, not after the next upgrade.

What is promised about upgrades:

- An upgrade is built from a public commit, in the pinned container, and its commit and executable hash are published before or with it.
- The upgrade authority stays on a hardware wallet and is not shared with any service.
- The intention is to revoke the authority once the program has been independently reviewed. No date is promised.

The program has no administrator role over any vault and cannot be paused. Short of an upgrade, a problem is met by stopping new deposits in the interface and by holders withdrawing; the command-line client exists so that does not depend on this website.

A website rollback cannot undo a transaction.

## What has not been done

The preconditions in [LAUNCH-RUNBOOK.md](LAUNCH-RUNBOOK.md) step 0 were not met before launch: no independent cryptographic review, no program audit, no completed [REVIEW-CHECKLIST.md](REVIEW-CHECKLIST.md), no legal review of the terms, and no run of the whole flow on real phones and in wallet apps' browsers. Bug bounties are planned; their scope and amounts are not final. These remain the work that would justify removing the word "unaudited" anywhere.
