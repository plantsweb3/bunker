# External review request

No reviewer has been engaged, no report has been obtained, and no audit badge may be displayed.

Suggested in two phases.

## Phase 1: design, before the code is frozen

- [PROTOCOL.md](PROTOCOL.md) in full, and its eleven open questions.
- The vendored Winterwallet SHA-256 Winternitz scheme (N=32, checksum, Merkle commitment), distinguished from standardized constructions.
- Whether one fixed, re-emitted recovery signature per epoch is acceptable for that scheme.
- The HKDF derivation and its context binding.
- Whether a zero waiting period should be permitted, and as the default.
- The separation between the offline tool and the website, and what distribution would make it meaningful.

## Phase 2: implementation, on a frozen tag

- `programs/bunker3`: owner, PDA and alias validation; SOL rent; classic SPL mint, owner, delegate and close-authority checks; CPI; error paths; arithmetic and time boundaries.
- Fuzzing of instruction lengths, account counts, partial proofs, duplicate accounts and adversarial token states.
- Spent markers, rollback of failed transactions, root-reinstallation rejection.
- Exact correspondence of `sdk/v3` and the program, with independent vectors.
- `sdk/v3/journal.ts`: crash windows, storage failure, same-origin races, multi-device use.
- `sdk/v3/kit.ts` and `sdk/v3/passkey.ts`: parsing, KDF, associated data, and what a passkey does and does not protect.
- `tools/recovery` and its build: page policy, bundle contents, reproducibility.
- The website: CSP, RPC proxy, release gate, dependency supply chain.
- Upgrade-authority policy, incident response, disclosure process and bounty.

## Release requirements

A written cryptographic assessment, an independent program audit, verified remediation, reproducible build evidence, publication of the program id and authority, operational ownership, and a deliberate source change to enable real-fund custody. Do not turn these into checkmarks without evidence.
