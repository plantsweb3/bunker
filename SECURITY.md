# Security policy

Bunker is experimental. Mainnet custody is disabled and no independent audit is complete. Do not deposit real funds or rely on the software for security-critical custody.

## Report privately

Use [GitHub private vulnerability reporting](https://github.com/plantsweb3/bunker/security/advisories/new). Include the affected commit, a minimal local reproduction, expected and observed behavior, and impact. Do not include passwords, wallet seeds, recovery files, API credentials, or private personal data. Do not test against other people's funds or accounts. Use the isolated validator.

If private reporting is unavailable, do not put exploit details in a public issue. The repository owner must restore that channel before collecting reports. There is no funded bounty, guaranteed response SLA, or completed audit represented by this policy.

## Scope

The Solana program, browser signer and recovery state, protocol encoding, RPC proxy, dependency supply chain, website deployment, and release process are in scope. Report dependency findings even if a browser-only path appears unreachable. Include evidence rather than assuming an npm scan proves exploitability or safety.

Read [THREAT-MODEL.md](docs/THREAT-MODEL.md), [CRYPTOGRAPHY.md](docs/CRYPTOGRAPHY.md) and [REVIEW-CHECKLIST.md](docs/REVIEW-CHECKLIST.md). Stale recovery backups and concurrent devices can reuse a one-time key. A compromised website can steal keys or alter transactions. Solana consensus, account keys, program upgrade authority, RPC integrity and token issuer powers remain part of the trust boundary.

## Supported release

Only the latest reviewed repository revision is maintained. This pre-release is suitable for inspection and valueless testing, not real-asset custody. Security fixes are published with explicit affected revisions and migration guidance where applicable. No independent source-to-mainnet-binary equivalence is claimed.
