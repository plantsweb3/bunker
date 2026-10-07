# Reviewer guide

This repository is a pre-release research and engineering artifact. Start with the threat model; assume no external audit or security level has been established.

1. Read `docs/CRYPTOGRAPHY.md` and compare `sdk/winternitz.ts` with the unchanged upstream source in `crates/winterwallet-core/src`. The fixture is public test material, never a runtime key. Add independent vectors; a shared bug can survive port-to-port comparisons.
2. Regenerate `fixtures/bunker-v2.json` with `cargo run -p bunker --locked --example protocol_vectors`; compare byte-for-byte and run both language tests. Inspect the pinned source hashes in `vendor/winterwallet-revision.json`. Compare the canonical payload in `sdk/protocol.ts` with `programs/bunker/src/lib.rs`. Track each account-owner, PDA, alias, signer, token-program, mint, destination and integer-bound check.
3. Trace `decode_intent`, `check_expiry`, `unspent`, `verify_proof`, transfer and rotation. Check all 154 payload bytes against the specification, including inclusive slot expiry and executing program/vault context. Trace successful and failed transfer paths. Root/nonce changes must commit atomically with the transfer, and vault rent must remain. There is no generic CPI router.
4. Review `sdk/recovery.ts` and every transition in `components/bunker/vault-app.tsx`: validate blob/journal/chain, persist consumption and advanced index, sign once, encrypt/checkpoint, download/re-open, publish, confirm, rotate and resume. Test crash windows and stale file/device scenarios. Browser coordination is explicitly not a production solution.
5. Run the unit, Rust and isolated-chain tests in `docs/TESTING.md`. The on-chain test identity has no mainnet significance. Tests use new disposable keypairs, never a repository-funded wallet.
6. Inspect `package-lock.json`, `Cargo.lock`, CI permissions/action revisions, CSP, API request bounds, dependency findings and deployment configuration. Check the exact Git commit used by the live deployment. Hosting metadata is not an audit attestation.

## Proposed next version

`docs/RECOVERY-POLICY-PROPOSAL.md` describes a recovery authority, a stable archival secret and delayed withdrawals. `docs/PROTOCOL-3-DRAFT.md` makes it concrete: account and message layouts, key derivation, instructions, a transition table and a list of open questions. Neither is implemented. Design feedback is most useful before code is written; the open questions at the end of the draft are the places to start.

## Trace without the UI

- Start from a vector's `payload` hex. Prepend the 20-byte domain and raw program/vault public keys; compare the 238-byte `message` and digest. Independently verify the signature against `root` using the unchanged Rust core.
- Read the 81-byte on-chain vault: bytes 8..40 are the signed identity, 40..72 the root, 72..80 the little-endian nonce, byte 80 the PDA bump. Recompute the PDA under the executing program.
- Inspect the proof owner's program, `BKPROOF2` magic, exact length, used length 1088 and message digest. The verifier checks all signature bytes. The uploader can reclaim proof rent; that never revokes a signature.
- Derive `["spent-v2", root]` and `["spent-v2", nextRoot]`. Both must be unused System-owned empty accounts before a withdrawal. The current marker becomes permanently program-owned in the same successful instruction as transfer/rotation. Next-root reinstall and root reuse after success must fail.
- Compare SOL balances or classic SPL mint/source/destination state before and after. Every remainder is under the new root through the same vault PDA. Force a transfer failure and verify the marker and root roll back while the off-chain journal remains consumed.
- Challenge expiry after proof publication, simultaneous different signatures from a stale key, replay, wrong account metas, frontend payload substitution, missing/zero next root, storage failure and divergent recovery state. `tests/chain.ts`, `tests/journal.test.ts`, `tests/protocol-v2.test.ts` and `programs/bunker/tests/protocol.rs` contain those boundaries.

## Evidence boundaries

`docs/evidence/` records local execution, with network and tool boundaries stated. CI checks can be independently inspected on GitHub. No checked-in passing log establishes that a different commit or deployed binary passed. No formal proof, differential fuzzer campaign, external penetration test or completed audit is claimed.

## Invariants to challenge

- Only a valid current one-time authorization can withdraw.
- The signed context fixes all transfer-critical fields.
- Rent reserve and token ownership cannot be bypassed through account aliasing.
- Replays fail after rotation; failure preserves current on-chain authority.
- A pending authorization retries the saved exact signature only through its expiry slot. Expired/failed/unconfirmed keys stay consumed.
- Import cannot reset an intact journal or reconcile a different next root. Separate-device split-brain remains possible.
- Default client and server configurations cannot submit mainnet custody transactions.

Private reports belong in the repository Security tab, not public issues containing working exploits or secrets.
