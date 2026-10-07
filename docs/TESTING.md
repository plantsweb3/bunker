# Testing

- `npm run typecheck`: strict TypeScript checks.
- `npm test`: exact amounts, canonical payload context, cross-language cryptographic vectors, tamper rejection, authenticated recovery encryption, release gate and simulation state machine.
- `cargo test -p winterwallet-core`: unchanged upstream crypto, mnemonic, and BIP39 tests.
- `npm run program:build`: compiles the SBF binary.
- `npm run test:chain`: real transactions against the isolated validator on 127.0.0.1:19099. Test program public ID is `AhZPKQAwKeCJ47PVKz5QZmBwf1PE8BHcmcqsjvSdPaZ`. The tests fund fresh local wallets from the local faucet. They do not use user wallets or network funds.
- `npm run test:e2e`: authored browser regression suite against a running local app. It checks routes, release gate, modal behavior, simulation, mobile overflow and errors. With the isolated validator running, a disposable Wallet Standard test wallet also exercises vault creation, encrypted backup verification, SOL deposit/withdrawal, key rotation, stale-file rejection and restoration after reload, on desktop and mobile. No user wallet or real funds are involved. Without the validator those custody cases report an explicit skip. See evidence for which checks were executed.

Local-chain evidence is in `docs/evidence/local-chain-tests.json`; its program is a local test identity, not a deployed mainnet address. Automated tests do not establish cryptographic security or replace independent audit.

Launch the validator with `scripts/local-validator.sh` in one terminal, then run `npm run test:chain`. The script uses dedicated RPC/gossip/faucet ports and a workspace-local ledger. It does not reset existing user ledgers. Set `BUNKER_LOCAL_LEDGER` if desired. Stop with Ctrl-C. The browser test configuration can be generated with `npm run setup:local`; restarting `npm run dev` picks it up. Remove `.env.local` to restore the mainnet read-only release.

The Vercel web build is native Next.js 16.4.0. CI runs browser checks against a production build. The RPC regression suite checks mainnet write refusal, pinned-genesis enforcement, malformed/cross-origin requests, and streaming byte limits. Browser checks verify nonce freshness and rejection of injected inline scripts. CI skips local custody cases unless a validator is explicitly available; the checked-in local-chain evidence is separate from GitHub CI.

The browser CI job uses the official Playwright 1.56.1 Noble container pinned by digest, with its preinstalled Chromium. Match the container version and npm Playwright version when upgrading. Production smoke tests can run with `BUNKER_E2E_BASE_URL=https://bunkermode.io npm run test:e2e -- tests/browser/app.spec.ts`; they do not sign transactions.
