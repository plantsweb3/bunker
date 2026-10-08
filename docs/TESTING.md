# Testing

- `npm run typecheck`: strict TypeScript checks.
- `npm test`: exact amounts, canonical payload context, cross-language cryptographic vectors, tamper rejection, authenticated recovery encryption, release gate and simulation state machine.
- `cargo test --workspace`: unchanged upstream crypto, mnemonic and BIP39 tests, plus Rust protocol-v2 encoding, signature/context, rotation fixtures and expiry boundary.
- `npm run program:build`: compiles the SBF binary.
- `npm run test:chain`: real transactions against the isolated validator on 127.0.0.1:19099. Test program public ID is `AhZPKQAwKeCJ47PVKz5QZmBwf1PE8BHcmcqsjvSdPaZ`. The tests fund fresh local wallets from the local faucet. They do not use user wallets or network funds.
- `npm run test:e2e`: authored browser regression suite against a running local app. It checks routes, release gate, modal behavior, simulation, mobile overflow and errors. With the isolated validator running, a disposable Wallet Standard test wallet also exercises vault creation, encrypted backup verification, SOL deposit/withdrawal, key rotation, stale-file rejection and restoration after reload, on desktop and mobile. No user wallet or real funds are involved. Without the validator those custody cases report an explicit skip. See evidence for which checks were executed.

Local-chain evidence is in `docs/evidence/local-chain-tests.json`; its program is a local test identity, not a deployed mainnet address. Automated tests do not establish cryptographic security or replace independent audit.

Launch the validator with `scripts/local-validator.sh` in one terminal, then run `npm run test:chain`. The script uses dedicated RPC/gossip/faucet ports and a workspace-local ledger. It does not reset existing user ledgers. Set `BUNKER_LOCAL_LEDGER` if desired. Stop with Ctrl-C. The browser test configuration can be generated with `npm run setup:local`; restarting `npm run dev` picks it up. Remove `.env.local` to restore the mainnet read-only release.

The Vercel web build is native Next.js 16.4.0. CI runs browser checks against a production build. The RPC regression suite checks mainnet write refusal, pinned-genesis enforcement, malformed/cross-origin requests, and streaming byte limits. Browser checks verify nonce freshness and rejection of injected inline scripts. CI skips local custody cases unless a validator is explicitly available; the checked-in local-chain evidence is separate from GitHub CI.

The browser CI job uses the official Playwright 1.56.1 Noble container pinned by digest, with its preinstalled Chromium. Match the container version and npm Playwright version when upgrading. Production smoke tests can run with `BUNKER_E2E_BASE_URL=https://bunkermode.io npm run test:e2e -- tests/browser/app.spec.ts`; they do not sign transactions.

## Protocol 3 draft

The draft program in `programs/bunker3` is not deployed and not used by the web app.

```sh
cargo test -p bunker3 --locked
cargo-build-sbf --manifest-path programs/bunker3/Cargo.toml --sbf-out-dir target/deploy
cd programs/bunker3-svm-tests && cargo test --locked
```

`npm test` also runs the TypeScript client tests (`tests/protocol-v3.test.ts`) and checks that `npx tsx scripts/v3-vectors.ts` reproduces `fixtures/bunker-v3.json` exactly. The VM suite re-derives those vectors independently in Rust and drives the compiled program with the client's bytes.

`npm run source:bundle` also builds the offline recovery tool (`npm run tool:build` builds it alone); the protocol 3 browser test opens that file from disk. With `target/deploy/bunker3.so` built, `scripts/local-validator.sh` also loads the draft program at the fixed test address `k7FaK87WHGVXzkaoHb7CdVPgkKDQhZ29VLDeBVbDfYn`, and `tests/browser/custody3.spec.ts` drives the protocol 3 app against it (it skips otherwise).

The first command exercises the state machine directly. The last loads `target/deploy/bunker3.so` into an in-process Solana VM (LiteSVM) and sets the Clock sysvar to test the waiting period and deadlines to the second. That crate is deliberately outside the workspace and has its own lockfile so the VM's dependency tree stays out of the program's. GitHub CI builds and tests the workspace; it does not run the VM suite.

## Protocol 2 reproduction

```sh
cargo run -p bunker --locked --example protocol_vectors > /tmp/bunker-v2.json
diff fixtures/bunker-v2.json /tmp/bunker-v2.json
npm test
cargo test --workspace --locked
npm run program:build
BUNKER_LOCAL_LEDGER=./work/validator-v2 ./scripts/local-validator.sh
# In a second terminal:
npm run test:chain
```

Use a new ledger path when changing program versions; an existing ledger does not reload the binary from `--bpf-program`. The chain report includes protocol version, local genesis, test program and binary SHA-256. It covers create/deposit/withdraw for SOL and classic SPL, remainder authority, identical proof retries, replay, a second valid signature under the spent key, attempts to reinstall a spent root, expiry after publication, malformed/truncated payloads, missing next commitments, account/mint/program/destination substitution, partial failure after journal advance, exact-signature retry and two separately restored copies racing different messages.

Same-origin journal tests block both identical and different re-signing, stale import, mismatched encrypted checkpoints, wrong chain state and storage failures. Separate-origin tests intentionally permit two signatures and prove only at-most-one accepted on-chain withdrawal. They do not establish cryptographic safety after split-brain. No automated test is an audit.

For a full browser-to-server custody check, start a separate local web server using the existing local-only environment settings (with the validator's actual genesis), then run:

```sh
BUNKER_E2E_BASE_URL=http://127.0.0.1:5175 BUNKER_E2E_REAL_RPC=true npm run test:e2e -- tests/browser/custody.spec.ts
```

This test mode requires `/api/config` to match the isolated validator and does not intercept `/api/config` or `/api/rpc`. Both desktop and mobile complete create, backup verification, deposit, withdrawal, stale-file rejection, restore after reload, and a second withdrawal under the recovered next key. The standard browser suite uses the read-only app with a local-only API fixture for custody, and independently checks actual mainnet submission refusal.
