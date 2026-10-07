# Reviewer guide

This repository is a pre-release research and engineering artifact. Start with the threat model; assume no external audit or security level has been established.

1. Read `docs/CRYPTOGRAPHY.md` and compare `sdk/winternitz.ts` with the unchanged upstream source in `crates/winterwallet-core/src`. The fixture is public test material, never a runtime key. Add independent vectors; a shared bug can survive port-to-port comparisons.
2. Compare the canonical payload in `sdk/protocol.ts` with `programs/bunker/src/lib.rs`. Track each account-owner, PDA, alias, signer, token-program, mint, destination and integer-bound check.
3. Trace successful and failed transfer paths. Root/nonce changes must commit atomically with the transfer, and vault rent must remain. There is no generic CPI router.
4. Review `sdk/recovery.ts` and every transition in `components/bunker/vault-app.tsx`: reserve intent, sign once, encrypt/checkpoint, download/re-open, publish, confirm, rotate and resume. Test crash windows and stale file/device scenarios. Browser coordination is explicitly not a production solution.
5. Run the unit, Rust and isolated-chain tests in `docs/TESTING.md`. The on-chain test identity has no mainnet significance. Tests use new disposable keypairs, never a repository-funded wallet.
6. Inspect `package-lock.json`, `Cargo.lock`, CI permissions/action revisions, CSP, API request bounds, dependency findings and deployment configuration. Check the exact Git commit used by the live deployment. Hosting metadata is not an audit attestation.

## Evidence boundaries

`docs/evidence/` records local execution, with network and tool boundaries stated. CI checks can be independently inspected on GitHub. No checked-in passing log establishes that a different commit or deployed binary passed. No formal proof, differential fuzzer campaign, external penetration test or completed audit is claimed.

## Invariants to challenge

- Only a valid current one-time authorization can withdraw.
- The signed context fixes all transfer-critical fields.
- Rent reserve and token ownership cannot be bypassed through account aliasing.
- Replays fail after rotation; failure preserves current on-chain authority.
- A pending authorization can resume only the exact same intent.
- Default client and server configurations cannot submit mainnet custody transactions.

Private reports belong in the repository Security tab, not public issues containing working exploits or secrets.
