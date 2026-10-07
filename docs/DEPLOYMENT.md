# Deployment

## Public website

The public project is `bunker` on Vercel, connected to `plantsweb3/bunker`, with the canonical domain **https://bunkermode.io**. The `www` hostname redirects to the apex. GitHub is the source of record; `main` is the production branch. `vercel.json` builds the source-download archive and native Next.js application. Use Node 22 and the committed npm lockfile.

The public release is mainnet **read-only**. No deployment signer, wallet secret, or seed is required to build or publish it. Do not set any `BUNKER_TEST_*`, `BUNKER_LOCAL_GENESIS`, or `BUNKER_ENABLE_TEST_CUSTODY` variables in Vercel production. The release gate has no environment-variable override for mainnet custody.

Set `SOLANA_RPC_URL` as a **sensitive, server-only** Vercel production environment variable for reliable reads. Never prefix it with `NEXT_PUBLIC_`. The default is Solana's public mainnet RPC, which may be unavailable or rate limited. Redeploy after changing environment variables. Do not paste provider keys into issues, commits, or browser code.

The RPC route uses a fixed configured endpoint, a method allowlist, origin checks, streaming byte limits, deadlines, and pinned genesis verification before test-network writes. Origin checks are not authentication. Before allocating a paid RPC quota, configure provider spending limits and an edge rate limit for `/api/rpc`; an in-memory limiter on a serverless instance is not a global quota. The frontend contains no analytics or third-party scripts. A per-request nonce authorizes scripts through Content Security Policy. Inline styles remain permitted for UI components.

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

Use the existing Vercel project linked to this repository. Review the deployment's commit SHA and build logs, then confirm `/api/config` reports `custodyEnabled: false`, `/api/verify` reports the actual review/deployment status, and `/api/rpc` refuses `sendTransaction`. Test both the canonical hostname and the `www` redirect over HTTPS. Vercel generates the downloadable source bundle at build time; its SHA-256 manifest checks integrity, not independent authorship or reproducibility of an on-chain binary.

Roll back the website through the Vercel deployment dashboard to a previously checked release. A website rollback cannot undo a transaction or restore a consumed one-time key. Do not roll back a future live custody release without a state-migration and incident-response plan.

## Isolated program testing

The local validator loads `target/deploy/bunker.so` at a fixed **test-only** identity. It needs no program private key. `scripts/setup-local.ts` checks the local program and pins the local genesis hash before creating the ignored `.env.local`. Restart the local app after changing this file; remove it to restore the mainnet read-only configuration.

Protocol 2 is not an in-place v1 migration. Build the new binary and use a **new** `BUNKER_LOCAL_LEDGER` directory; existing validator ledgers keep their old program state. Do not reset another experiment's ledger. Never import v1 recovery material into v2 or fund the public fixture keys. Version 2 adds a permanent spent-root marker (8 bytes, one per successful withdrawal), so local fee payers need marker rent as well as transaction fees. Failed transactions do not persist that marker.

Before any later test deployment, run the workspace Rust tests, regenerate and compare the v2 fixture, build SBF, run isolated-chain tests and browser custody flows, and record the binary SHA-256. The checked-in chain report identifies the tested binary; this is not proof of equivalence to a public deployment. No mainnet program deployment is part of this revision. Real-fund enablement still requires a later reviewed release and an explicit source change; adding an environment bypass is prohibited.

Recovery blobs now use `bunker-encrypted-v2` with authenticated metadata and canonical indices/root. Do not clear or roll back the journal to make a failed signing attempt work. Preserve the exact pending blob; reconcile chain root/nonce before retrying the saved signature. After expiry, stop: there is no supported cancellation or replacement. A deployment rollback cannot unconsume a signing key.

Optional devnet tooling requires dedicated test-only deployment keys explicitly supplied by the operator. It verifies the devnet genesis and never reads the default wallet. The public website does not depend on a devnet deployment.

## Real-fund launch blockers

Complete `REVIEW-CHECKLIST.md` with independent cryptographic and Solana program reviewers. Resolve findings, freeze a reviewed release, reproduce its binary, publish source-to-deployment verification, and agree on an upgrade-authority policy. Browser key-state rollback, multi-device use, stale recovery files, and pending-intent liveness require review. The current repository is review material, not evidence that those blockers are solved. External review needs a chosen provider, engagement approval, and a quote; no audit has been commissioned.
