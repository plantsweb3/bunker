<p align="center"><img src="public/brand/bunker-logo-horizontal-stone.svg" width="420" alt="Bunker" /></p>

# Bunker

**Independent hash-based withdrawal authorization for Solana.**

[Website](https://bunkermode.io) · [Security policy](SECURITY.md) · [Reviewer guide](docs/REVIEWER-GUIDE.md) · [Cryptographic specification](docs/CRYPTOGRAPHY.md)

Bunker separates a transaction-fee wallet from a vault's withdrawal authority. The experimental Solana program accepts a one-time hash signature over an exact transfer and its next authority commitment. The web app includes a no-wallet demo, wallet connection, SOL/classic SPL balances, encrypted recovery, and complete local-test create/deposit/withdraw flows.

**Release status:** public pre-release; mainnet balances are read-only. No Bunker program is deployed on mainnet, no independent audit is complete, and real-fund custody is disabled. Bunker does not custody Bitcoin and claims no end-to-end post-quantum security level. Tests and readable source are evidence for review, not a substitute for review.

## Start reviewing

| Question | Start here |
|---|---|
| What does the program permit? | [Program](programs/bunker/src/lib.rs), [architecture](docs/ARCHITECTURE.md) |
| What exactly is signed? | [Protocol encoding](sdk/protocol.ts), [cryptography](docs/CRYPTOGRAPHY.md) |
| Where do the primitives come from? | [Upstream core](crates/winterwallet-core), [cross-language fixture](fixtures/winterwallet-n32.json) |
| What can go wrong? | [Threat model](docs/THREAT-MODEL.md), [external review scope](docs/REVIEW-CHECKLIST.md) |
| How are recoveries handled? | [Recovery](sdk/recovery.ts), [browser orchestration](components/bunker/vault-app.tsx) |
| What has actually been tested? | [Testing](docs/TESTING.md), [recorded evidence](docs/evidence) |
| How do I report a vulnerability? | [Private reporting](https://github.com/plantsweb3/bunker/security/advisories/new) |

## Run the website

Node 22 LTS and npm are required. Dependencies are pinned in `package-lock.json`.

```sh
npm ci
npm run dev
```

Open `http://localhost:5173`. Default configuration is mainnet read-only. `npm run build` produces a standard Next.js build; `npm start` serves it. Fonts, logos, and imagery are served from the app's own origin. There are no analytics or third-party client scripts.

## Exercise custody on an isolated local validator

Install the official Solana/Agave CLI and Rust toolchain. With their executables on PATH:

```sh
npm run program:build
./scripts/local-validator.sh
```

In a separate terminal:

```sh
npm run test:chain
npm run setup:local
npm run dev
```

Use a disposable Solana Wallet Standard wallet advertising `solana:localnet`, or run the browser custody tests with their generated local test wallet. The local faucet supplies valueless assets. Do not import a real funded wallet to test this software. `setup:local` pins the local chain's genesis hash. Remove `.env.local` to restore the public read-only configuration.

The experimental signature key must never authorize two different messages. One browser's lock/journal cannot protect against stale backups, separate devices, cleared storage, a malicious frontend, or chain rollback. These are unresolved production design issues. Protocol 2 adds an inclusive expiry slot. Expiry never makes a consumed key reusable: there is no cancellation or replacement path, and an expired or irrecoverable authorization can permanently lock assets. Read the threat model before experimenting.

Protocol 2 is a breaking **local test** revision: versioned signed bytes, on-chain spent-commitment markers, slot expiry, and canonical encrypted recovery with consumption before signing. V1 accounts/files are rejected; use a fresh ledger and fresh test keys. See the [byte-level specification](docs/CRYPTOGRAPHY.md) and [reproducible v2 fixtures](fixtures/bunker-v2.json). Fees, account creation and the Solana runtime continue to use ordinary signatures.

## Verify

```sh
npm run typecheck
npm test
cargo test --workspace --locked
npm run test:chain
npm run test:e2e
npm run audit:dependencies
npm run source:bundle
npm run build
```

Browser tests need the app at `127.0.0.1:5173` and Playwright Chromium. Custody browser cases explicitly skip without the isolated validator. CI records web/primitive checks; local validator evidence is separately identified. [Testing instructions](docs/TESTING.md) describe the boundaries.

## Deployment

[Deployment guide](docs/DEPLOYMENT.md) covers Vercel, the domain, environment variables and production release gates. No production signers, wallet keys or recovery files belong in this repository. No environment flag can enable mainnet custody; accepting real funds requires a reviewed release with deliberate source changes.

## License and attribution

Bunker-authored code is MIT. Vendored Winterwallet retains Dean Little's MIT license and revision `672fc6789b1532ee680f24842d235e0be8737b61`; its algorithm source is unchanged. The upstream construction is unaudited and is not WOTS+, LMS or XMSS. Third-party dependency and asset provenance notices are preserved in [THIRD_PARTY.md](THIRD_PARTY.md). Brand assets do not grant endorsement or trademark rights.
