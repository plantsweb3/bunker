# Testing

Automated tests do not establish cryptographic security and are not an audit.

## Commands

| Command | What it covers |
|---|---|
| `npm run typecheck`, `npm run lint` | Strict TypeScript and lint over app, client, tool, scripts and tests |
| `npm test` | Client: exact amounts, the vendored-primitive vectors, key derivation and encodings, byte-for-byte reproduction of `fixtures/bunker-v3.json`, the vault identity, signing journal (including a chain view that goes back), key files, public file formats, activity classification, alert state changes, wallet-check classification, preflight decisions, RPC proxy rules and limits, release gate, and that the source bundle is exactly what Git tracks or would track (tracked files plus new files not ignored) and refuses key material |
| `cargo test --workspace --locked` | The unchanged upstream primitive's own tests; the program's state machine row by row (`programs/bunker3/tests/state.rs`); fixed-seed randomized sequences and decoder inputs (`tests/model.rs`) |
| `npm run program:build` | Compiles the program to `target/deploy/bunker3.so` |
| `cd programs/bunker3-svm-tests && cargo test --locked` | The compiled program in an in-process Solana VM (LiteSVM) with the Clock sysvar set, so waiting periods and deadlines are tested to the second (`tests/program.rs`); isolation between vaults and between a vault and whoever creates it (`tests/isolation.rs`); plus the client's vectors against an independent Rust derivation (`tests/client_vectors.rs`) |
| `npm run test:chain` | Repeated create, withdraw, replay and recovery cycles on the local validator through the client. `CYCLES=40` sets the count. Prints a summary. |
| `npm run test:alerts` | The alert watcher against the compiled program on the local validator, with Telegram replaced by a list: no alert for history before subscribing, one per event, none on a repeat pass, an announcement still reported after the vault's address is flooded with transactions, no alert when a stranger's recovery merely touches the watched vault, none after `/stop` |
| `npm run test:cli` | The command-line client on the local validator: withdraw with and without a waiting period, a stale review refused, cancel by recovery, the old day key refused, a wrong network refused, and the real program run with typed answers (the review printed, the password not echoed, anything but "sign" signing nothing) |
| `npm run test:e2e` | Browser, desktop and mobile. Always: routes, the content security policy on every page, release gate, demo, wallet check, mobile overflow. With the local validator running: the full custody flows below. |

The VM suite is a standalone crate with its own lockfile so the VM's dependencies stay out of the program's. It needs `bunker3.so` built first. GitHub CI builds and tests the workspace, builds the program with a toolchain it has checked by hash and runs the VM suite, keeps the built program and its hash for commits on `main`, and runs the browser suite against a production build; it does not run the chain cycles or the custody browser cases, which need a validator.

## Local validator

```sh
npm run program:build
./scripts/local-validator.sh          # terminal 1; set BUNKER_LOCAL_LEDGER to choose the ledger path
npm run source:bundle && npm run build && npm start   # terminal 2
npm run test:e2e && npm run test:chain                # terminal 3
```

The validator loads the program at the fixed test-only address `k7FaK87WHGVXzkaoHb7CdVPgkKDQhZ29VLDeBVbDfYn`, the same one `fixtures/bunker-v3.json` uses. It uses dedicated ports and needs no program keypair. Use a new ledger path after rebuilding the program: an existing ledger keeps its old binary. `npm run setup:local` writes a `.env.local` so `npm run dev` talks to it; remove that file to return to the read-only configuration. Tests fund fresh disposable wallets from the local faucet and never use a user wallet.

`npm run source:bundle` also builds the offline recovery tool (`npm run tool:build` builds it alone). The custody browser cases open that file from disk as a `file://` page, pass every file between it and the site through the filesystem, and assert the tool page issued no network request.

## Custody browser cases (`tests/browser/custody3.spec.ts`)

Every case gives the day key a different password from the recovery kit and asserts the tool refuses equal ones.

0. **Trusted addresses:** a Bunker with a 24-hour wait and one trusted address; SOL and a token to the trusted address arrive on the third approval (the token case proves the program finds the wallet's real associated token account); the same day key sending to a stranger only gets an announcement that waits.
1. **No waiting period:** build, deposit, withdraw; the funds arrive on the third approval; a second withdrawal uses the next key.
2. **Opted-in waiting period:** the kit cannot be created until the waiting period is acknowledged; announce; on-chain state and balances asserted; countdown shown; a packet for the wrong generation is refused; cancel by recovery; the old day key is refused; the new one announces; seal.
3. **Tokens:** mint a test token, deposit, withdraw to a recipient with no token account, assert both balances, refuse an amount above the balance.
4. **Passkey:** with a simulated authenticator supporting PRF: save a day key, assert storage holds no plaintext, reopen with the passkey (after the cross-device statement, without which the button is disabled), withdraw, then alter the ciphertext and assert it does not unlock.

5. **Bunker Mode:** sweep the wallet's SOL and tokens in, leaving the fee reserve, then read the activity log back.

The browser cannot wait 24 hours, so releasing after a wait is exercised by the VM suite, not by a click.

## How the tests were checked

For the program, eight safety checks were removed one at a time and the VM suite re-run. Seven were caught immediately; removing destination binding was not caught by the first version of the suite, and a dedicated test was added and confirmed to fail without the check. After the internal review ([INTERNAL-REVIEW.md](INTERNAL-REVIEW.md)) the same was done for the four checks it added: computing the vault identity from the creation data, scoping markers to the vault, returning a closed proof to the system program, and the bound on an announcement's deadline. Each removal failed the suite. When the randomized model was rebuilt around an adversarial operational signer, the old rule it was written to catch (retiring an unsigned root at recovery) was put back into the model and the model failed on its second sequence. This has not been repeated for every later change.

The suites passed while two critical flaws were present, because no test put two vaults in one world, and the first randomized model passed while a third was present, because its operational signer chose roots at random and so never chose a harmful one. Passing tests show the cases someone thought of.

## Known gaps

- No coverage-guided fuzzing. The randomized tests cover the pure state machine and decoders, not account validation.
- No independent implementation by a second author.
- Passkeys are tested only with Chromium's virtual authenticator; no real phone or wallet in-app browser.
- Two token tests in the VM suite (one path that succeeds, one of wrong accounts) and one scenario in the browser.
- No test of fork, rollback or clock-drift behaviour.

## Other

CI runs the browser job in the official Playwright container pinned by digest; match its version to `package-lock.json` when upgrading. A read-only smoke test of the live site: `BUNKER_E2E_BASE_URL=https://bunkermode.io npm run test:e2e -- tests/browser/app.spec.ts`.

A separate scheduled workflow (`.github/workflows/live-tool.yml`) builds the offline recovery tool from `main` once a day and compares it byte for byte with the file the website serves.
