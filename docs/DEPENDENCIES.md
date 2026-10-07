# Dependency policy

Direct npm versions and Cargo resolutions are committed. Install with `npm ci` and run Cargo with `--locked`. Dependabot proposes weekly npm, Cargo, and workflow updates; proposals require review and tests. Never treat a clean advisory scan as a cryptographic assessment.

The October 7, 2026 release uses Next.js 16.4.0 after removing a critical advisory affecting the earlier installed release. Classic SPL instructions use the official generated `@solana-program/token` API through a small adapter to the wallet's legacy transaction format. The old SPL package's `bigint-buffer` dependency has been removed. SOL and SPL transfer behavior is checked against the local validator.

The lockfile has explicit overrides for Jayson 5.0.0, Sharp 0.35.5, ws 8.22.0, source-map-js 1.2.2, and baseline-browser-mapping 2.11.0. These replace vulnerable transitive resolutions. Jayson is used through its browser client by web3.js; the local chain and browser tests exercise that transport. Recheck upstream compatibility when changing these overrides, and remove them once parent packages resolve patched versions on their own.

`npm run audit:dependencies` checks runtime npm advisories. The CI job also checks TypeScript, lint, unit tests, Rust builds/tests, and desktop/mobile browser behavior. Rust advisory monitoring and a full supply-chain review are separate obligations for the independent release review. The source bundle deliberately excludes dependencies, secrets, build output, recovery files, and local ledgers.
