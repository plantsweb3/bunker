# Contributing

Read SECURITY.md before filing a vulnerability. Keep ordinary issues focused on reproducible behavior and public information.

Use Node 22 LTS, `npm ci`, `npm run typecheck`, `npm test` and `npm run build`. Changes to transaction construction also need the isolated-validator suite; signer/recovery changes need browser custody tests. Record which checks ran and which did not. Preserve third-party licenses and provenance.

Use a focused pull request describing the problem, resulting behavior and evidence. Do not change cryptographic parameters, canonical encoding, account layout, token support, signer state or mainnet gating without explicit design review. Include failure cases rather than tests that merely repeat the implementation.

Never commit wallet keys, recovery files, passwords, private RPC URLs, environment files, validator ledgers or downloaded browser traces. Do not add generated source archives to Git; deployment builds generate their own downloadable snapshot. Do not claim audits, verification, endorsements or security levels without linked evidence.
