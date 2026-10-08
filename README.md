<p align="center"><img src="public/brand/bunker-logo-horizontal-stone.svg" width="420" alt="Bunker" /></p>

# Bunker

**A separate vault on Solana that your wallet key cannot open.**

[Website](https://bunkermode.io) · [Security policy](SECURITY.md) · [Reviewer guide](docs/REVIEWER-GUIDE.md) · [Protocol specification](docs/PROTOCOL.md)

Assets go into a program-owned vault from any wallet. They come out only with a one-time hash signature from a key the wallet never holds. A stolen seed phrase or a signature given to a drainer site cannot authorize a withdrawal. One recovery kit, kept offline, replaces lost or exposed keys and cancels a withdrawal that is still waiting.

**Release status:** public pre-release, draft protocol. The website's mainnet configuration is read-only. No Bunker program is deployed on mainnet, no independent audit is complete, and real-fund custody is disabled. Bunker claims no end-to-end post-quantum security level. Tests and readable source are evidence for review, not a substitute for it.

## Start reviewing

| Question | Start here |
|---|---|
| What can go wrong, and what is not defended? | [Threat model](docs/THREAT-MODEL.md) |
| What exactly does the program permit? | [Protocol specification](docs/PROTOCOL.md), [program](programs/bunker3/src) |
| What is signed, and where do the primitives come from? | [Cryptography](docs/CRYPTOGRAPHY.md), [vendored core](crates/winterwallet-core) |
| How are keys derived and stored? | [Client](sdk/v3), [offline recovery tool](tools/recovery) |
| How is it put together? | [Architecture](docs/ARCHITECTURE.md) |
| What has actually been tested, and what has not? | [Testing](docs/TESTING.md) |
| What would an external review cover? | [Review request](docs/REVIEW-CHECKLIST.md) |
| How do I report a vulnerability? | [Private reporting](https://github.com/plantsweb3/bunker/security/advisories/new) |

## How it works, briefly

- **Wallet key:** pays fees and deposits. It has no authority over the vault.
- **Day key:** announces withdrawals. Each withdrawal uses a one-time key and installs the next one.
- **Recovery kit:** opened only in an offline tool that cannot connect to anything. It builds a vault, replaces a lost or stolen day key, and cancels a waiting withdrawal by installing new keys. It never moves assets.
- **Waiting period:** optional, chosen when a vault is built, off by default. With one, an announced withdrawal waits and can be cancelled. Without one, a stolen day key can withdraw immediately; see the threat model.

## Run the website

Node 22 LTS and npm. Dependencies are pinned in `package-lock.json`.

```sh
npm ci
npm run dev
```

Open `http://localhost:5173`. The default configuration is mainnet read-only. There are no analytics or third-party client scripts.

## Run custody on an isolated local validator

Install the Solana/Agave CLI and a Rust toolchain.

```sh
npm run program:build
./scripts/local-validator.sh
```

In a second terminal:

```sh
npm run setup:local
npm run source:bundle     # also builds the offline recovery tool
npm run dev
```

Use a disposable Wallet Standard wallet that advertises `solana:localnet`, or run the browser tests with their generated test wallet. Do not import a funded wallet. Remove `.env.local` to return to the read-only configuration.

## Verify

```sh
npm run typecheck && npm run lint && npm test
cargo test --workspace --locked
npm run program:build
(cd programs/bunker3-svm-tests && cargo test --locked)
npm run test:chain          # needs the local validator
npm run test:e2e            # needs the app running; custody cases need the validator
npm run audit:dependencies
```

[Testing](docs/TESTING.md) says what each covers, what CI does not run, and the known gaps.

## Deployment

[Deployment guide](docs/DEPLOYMENT.md). No production signers, wallet keys or key files belong in this repository. No environment flag can enable mainnet custody.

## License and attribution

Bunker-authored code is MIT. Vendored Winterwallet retains Dean Little's MIT license at revision `672fc6789b1532ee680f24842d235e0be8737b61`; its algorithm source is unchanged. That construction is unaudited and is not WOTS+, LMS or XMSS. Third-party notices are in [THIRD_PARTY.md](THIRD_PARTY.md); image provenance is in [docs/IMAGE-PROVENANCE.txt](docs/IMAGE-PROVENANCE.txt). Brand assets do not grant endorsement or trademark rights.
