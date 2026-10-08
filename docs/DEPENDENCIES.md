# Dependency policy

Direct npm versions and Cargo resolutions are committed. Install with `npm ci` and run Cargo with `--locked`. Dependabot proposes weekly npm, Cargo, and workflow updates; proposals require review and tests. Never treat a clean advisory scan as a cryptographic assessment.

The October 7, 2026 release uses Next.js 16.4.0 after removing a critical advisory affecting the earlier installed release. Classic SPL instructions use the official generated `@solana-program/token` API through a small adapter to the wallet's legacy transaction format. The old SPL package's `bigint-buffer` dependency has been removed. SOL and SPL transfer behavior is checked against the local validator.

The lockfile has explicit overrides for Jayson 5.0.0, Sharp 0.35.5, ws 8.22.0, source-map-js 1.2.2, and baseline-browser-mapping 2.11.0. These replace vulnerable transitive resolutions. Jayson is used through its browser client by web3.js; the local chain and browser tests exercise that transport. Recheck upstream compatibility when changing these overrides, and remove them once parent packages resolve patched versions on their own.

`npm run audit:dependencies` checks runtime npm advisories. The CI job also checks TypeScript, lint, unit tests, Rust builds/tests, and desktop/mobile browser behavior. Rust advisory monitoring and a full supply-chain review are separate obligations for the independent release review. The source bundle deliberately excludes dependencies, secrets, build output, recovery files, and local ledgers.

## Remaining development-tool advisory

As of October 7, 2026, a full npm advisory scan reports **one underlying high-severity advisory across five dependency nodes**: [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), a stack-exhaustion denial of service in `braces <=3.0.3`. It is reached through Next's ESLint plugin → fast-glob → micromatch. There is no patched upstream braces release at this check. It is absent from the production dependency graph; lint processes trusted repository paths in a time-limited CI job. This advisory remains disclosed, not suppressed. Do not downgrade the production Next.js framework to follow npm's suggested ESLint downgrade. Track the upstream fix before closing the finding.

Vitest was upgraded to 4.1.11, tsx to 4.23.15, and compatible transitive dependencies refreshed to remediate the other reported development advisories. Runtime npm advisories remain zero at the recorded check.

The Rust program imports the specific official Solana account, entrypoint, CPI, public-key, system-interface, hashing, rent, and sysvar crates it uses. Removing the `solana-program` umbrella also removes its unused secp256k1 recovery dependency and the affected rand 0.7 chain. The signature verifier (`crates/bunker-lmots`) depends only on the SHA-256 hasher crate, which is a system call on-chain; the `hmac`, `pbkdf2`, `sha2` and `zeroize` crates the earlier vendored verifier pulled in are gone from the workspace. The local validator and the in-process VM suite exercise the compiled binary.

The in-process VM suite (`programs/bunker3-svm-tests`) is a standalone crate with its own lockfile: LiteSVM, the Solana crates it requires, and RustCrypto `hkdf` and `sha2` for an independent derivation check. None of these are dependencies of the program or the website.

The offline recovery tool is bundled with esbuild, which is already present as a dependency of the development tooling. Its bundle is about 123 KB: this project's own code (eight files; a test pins the list) and three third-party packages, `zod` for checking the shape of files, `@noble/hashes` for SHA-256, HKDF and scrypt, and `@noble/curves` for the one curve check that deriving a Solana address needs. It contains no Solana client library and no network code. An earlier build pulled in `@solana/web3.js` and twenty other packages to derive addresses; `sdk/v3/core.ts` now does that in about forty lines, and the tests hold it against `@solana/web3.js` on several hundred inputs.
