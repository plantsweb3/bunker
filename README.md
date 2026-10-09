<p align="center"><img src="public/brand/bunker-logo-horizontal-stone.svg" width="420" alt="Bunker" /></p>

# Bunker

**A separate vault on Solana that your wallet key cannot open.**

[Website](https://bunkermode.io) · [Security policy](SECURITY.md) · [Reviewer guide](docs/REVIEWER-GUIDE.md) · [Protocol specification](docs/PROTOCOL.md)

Assets go into a program-owned vault from any wallet. They come out only with a one-time hash signature from a key the wallet never holds. A stolen seed phrase or a signature given to a drainer site cannot authorize a withdrawal. One recovery kit, kept offline, replaces lost or exposed keys and cancels a withdrawal that is still waiting.

**Release status:** public beta on Solana mainnet. The program is live on Solana mainnet at `DGXACBwbUqRKRVR1TQojZBoRuV2TZJ8wVnQSuLKm2nJJ`, built from commit `2182e5f` (executable hash `a7f39161fd812132e1e43a9a942cbda6b2fcc62bbc8235b0bca72f9bafbf08f7`). It holds real funds. No independent audit has been done and none is booked. The program is upgradeable by one key, `Ci5cG8d6MvU5ykKkQhN3LHnPN2VCmwZuotRNLqA9SYth`, held by the maintainer on a hardware wallet. Use it only with what you could afford to lose. See [Deployment](docs/DEPLOYMENT.md) and [Security](SECURITY.md).

## Start reviewing

| Question | Start here |
|---|---|
| What can go wrong, and what is not defended? | [Threat model](docs/THREAT-MODEL.md) |
| What exactly does the program permit? | [Protocol specification](docs/PROTOCOL.md), [program](programs/bunker3/src) |
| What is signed, and where do the primitives come from? | [Cryptography](docs/CRYPTOGRAPHY.md), [signature verifier](crates/bunker-lmots) |
| How are keys derived and stored? | [Client](sdk/v3), [offline recovery tool](tools/recovery) |
| How is it put together? | [Architecture](docs/ARCHITECTURE.md) |
| What has actually been tested, and what has not? | [Testing](docs/TESTING.md) |
| What would an external review cover? | [Review request](docs/REVIEW-CHECKLIST.md) |
| How do I report a vulnerability? | [Private reporting](https://github.com/plantsweb3/bunker/security/advisories/new) |

## How it works, briefly

- **Wallet key:** pays fees and deposits. It has no authority over the vault.
- **Day key:** announces withdrawals. Each withdrawal uses a one-time key and installs the next one.
- **Recovery kit:** opened only in an offline tool whose own policy stops it making network connections. It builds a vault, replaces a lost or stolen day key, and cancels a waiting withdrawal by installing new keys. It never moves assets.
- **Trusted addresses and the waiting period:** chosen when a vault is built and fixed for its life. A withdrawal to one of up to four trusted addresses arrives at once. A withdrawal to anywhere else waits (24 hours unless another period is chosen) and can be cancelled with the recovery kit, so a stolen day key can pay only the owner's own addresses without waiting. The wait can be turned off; then a stolen day key can withdraw anywhere immediately. See the threat model.

## Run the website

Node 22 LTS and npm. Dependencies are pinned in `package-lock.json`.

```sh
npm ci
npm run dev
```

Open `http://localhost:5173`. The default configuration is Solana mainnet and the one published program. There are no analytics or third-party client scripts.

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
npm run test:cli            # the command-line client, on the local validator
npm run test:deploy         # the deployment check, against real deployments on the local validator
npm run test:e2e            # needs the app running; custody cases need the validator
npm run audit:dependencies
```

## Without the website

`tools/cli/bunker.ts` reads a Bunker, withdraws, finishes an interrupted withdrawal, releases, clears and submits a recovery packet, using a day key file, an ordinary Solana keypair file to pay fees, and an RPC address. It shares the site's signing code and keeps its signing journal in a file beside the day key. It never opens a recovery kit, and like the site, on mainnet it sends only to the published program.

`npm run cli:build` bundles it into one file, `public/source/bunker-cli.mjs`, that runs with Node 22 and nothing else (`node bunker-cli.mjs help`). The site serves that file with its SHA-256, and CI rebuilds it and checks the two builds are identical.

[Testing](docs/TESTING.md) says what each covers, what CI does not run, and the known gaps.

## Deployment

[Deployment guide](docs/DEPLOYMENT.md). No production signers, wallet keys or key files belong in this repository. No environment setting can point the site at a different mainnet program.

## License and attribution

Bunker-authored code is MIT. The one-time signature is LM-OTS as specified in RFC 8554, implemented here from the RFC text and checked against its published test vectors; it is used on its own rather than inside the LMS system that document mainly describes, and it is unaudited. Third-party notices are in [THIRD_PARTY.md](THIRD_PARTY.md); image provenance is in [docs/IMAGE-PROVENANCE.txt](docs/IMAGE-PROVENANCE.txt). Brand assets do not grant endorsement or trademark rights.
