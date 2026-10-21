# Security policy

Bunker is in public beta on Solana mainnet and holds real funds. CertiK audited the on-chain program and its signature verifier (commit `f6a37ce`) and published its report on 2026-10-20: https://skynet.certik.com/projects/bunker-mode. No critical, high or medium issues; of its four findings, three are resolved and one is acknowledged. The one code fix is live in commit `9bb0856`, and the upgrade authority has been renounced. The website, offline tool, command-line client and browser extension were not part of that audit. Its upgrade authority has been renounced: nobody can change the program, and a flaw cannot be fixed in place. Deposit only what you could afford to lose.

## Report privately

Use [GitHub private vulnerability reporting](https://github.com/plantsweb3/bunker/security/advisories/new). Include the affected commit, a minimal local reproduction, expected and observed behavior, and impact. Do not include passwords, wallet seeds, recovery files, API credentials, or private personal data. Do not test against other people's funds or accounts. Use the isolated validator.

If private reporting is unavailable, do not put exploit details in a public issue. The repository owner must restore that channel before collecting reports. There is a bug bounty, described at https://bunkermode.io/bounty; its payout amounts are not set yet. There is no guaranteed response time and no completed audit.

## Scope

The Solana program, browser signer and journal, offline recovery tool, protocol encoding, RPC proxy, dependency supply chain, website deployment, and release process are in scope. Report dependency findings even if a browser-only path appears unreachable. Include evidence rather than assuming an npm scan proves exploitability or safety.

Read [THREAT-MODEL.md](docs/THREAT-MODEL.md), [PROTOCOL.md](docs/PROTOCOL.md), [CRYPTOGRAPHY.md](docs/CRYPTOGRAPHY.md) and [REVIEW-CHECKLIST.md](docs/REVIEW-CHECKLIST.md). Using one day key on more than one device can reuse a one-time key. A compromised website can steal keys or alter transactions. Solana consensus, account keys, program upgrade authority, RPC integrity and token issuer powers remain part of the trust boundary.

## Supported release

Only the latest revision of `main` is maintained. Only the program and signature verifier have been independently reviewed (CertiK, at commit `f6a37ce`, with the fix for its one code finding in `9bb0856`; report published 2026-10-20). This is a public beta: software holding real funds at its users' own risk. Security fixes are published with explicit affected revisions and migration guidance where applicable. A public verified-builds service reports that the deployed program matches commit `9bb0856` (docs/DEPLOYMENT.md); that is a statement about which code is deployed, not about whether it is correct.
