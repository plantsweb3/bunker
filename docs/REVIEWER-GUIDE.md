# Reviewer guide

This repository is a pre-release research and engineering artifact. Assume no external audit or security level has been established. Nothing is deployed on mainnet.

## Read in this order

1. [THREAT-MODEL.md](THREAT-MODEL.md) — what each secret can do, and what is not defended.
2. [PROTOCOL.md](PROTOCOL.md) — derivation, layouts, signed bytes, instructions, the transition table, and eleven open questions. **The open questions are where design feedback is most useful.**
3. [CRYPTOGRAPHY.md](CRYPTOGRAPHY.md) — the vendored primitive, what is signed, file encryption, the journal.
4. `programs/bunker3/src/state.rs` (about 280 lines, pure) then `src/lib.rs` (about 380 lines).
5. `sdk/v3/` — `derive.ts`, `protocol.ts`, `authority.ts`, then `kit.ts`, `journal.ts`, `requests.ts`, `passkey.ts`.
6. `tools/recovery/` and `scripts/build-recovery-tool.mjs`.

## Things to check

- Compare `sdk/winternitz.ts` with the unchanged upstream source in `crates/winterwallet-core/src`. `vendor/winterwallet-revision.json` pins the upstream files. A shared bug can survive a port-to-port comparison; add independent vectors.
- Trace every account in each instruction: owner, PDA derivation, writability, signer, aliasing between vault, proof, markers and destination.
- Regenerate `fixtures/bunker-v3.json` with `npx tsx scripts/v3-vectors.ts` and compare. The Rust check in `programs/bunker3-svm-tests/tests/client_vectors.rs` re-derives it with a different HKDF implementation.
- The claim that re-emitting the fixed recovery signature is safe (PROTOCOL.md open question 1).
- A zero waiting period being permitted and the interface default (open question 11).
- The journal's crash windows (`sdk/v3/journal.ts`) and the fact that it cannot see a second device.
- The offline tool's page policy, and that `sdk/v3/requests.ts` schemas reject any field beyond the public ones.
- `package-lock.json`, `Cargo.lock`, CI permissions and pinned action revisions, the site's CSP, and the RPC proxy's allowlist and bounds.

## Invariants to challenge

- Only `execute` debits a vault, and only what a verified announcement recorded, to that destination, once, not before the vault's waiting period.
- An operational key cannot change the recovery root or invalidate a recovery packet.
- A recovery packet applies to exactly one epoch and can only install the roots it names.
- A retired root is never an authority again, in either role, in any vault under the program.
- A rejected instruction changes nothing.
- The default configuration, client and server, cannot submit a mainnet custody transaction.

## Evidence and its limits

[TESTING.md](TESTING.md) lists every suite, what it covers, what CI does not run, and known gaps. No formal proof, coverage-guided fuzzing campaign, penetration test or completed audit is claimed.

Report privately through the repository's Security tab, not in public issues.
