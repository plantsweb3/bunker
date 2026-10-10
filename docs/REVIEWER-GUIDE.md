# Reviewer guide

This repository is the source of a public beta running on Solana mainnet and holding real funds (program and build in [DEPLOYMENT.md](DEPLOYMENT.md)). Assume no external audit or security level has been established.

## Read in this order

1. [THREAT-MODEL.md](THREAT-MODEL.md) — what each secret can do, and what is not defended.
2. [PROTOCOL.md](PROTOCOL.md) — derivation, layouts, signed bytes, instructions, the transition table, and seventeen questions put to reviewers. **The open questions are where design feedback is most useful.**
3. [CRYPTOGRAPHY.md](CRYPTOGRAPHY.md) — the signature scheme and how its use relates to RFC 8554, what is signed, file encryption, the journal.
4. [INTERNAL-REVIEW.md](INTERNAL-REVIEW.md) — what the project's own adversarial review found and changed, so you do not spend time rediscovering it. It is not an audit.
5. `crates/bunker-lmots/src/lib.rs` (the verifier), then `programs/bunker3/src/state.rs` (pure) and `src/lib.rs`.
6. `sdk/lmots.ts`, then `sdk/v3/` — `derive.ts`, `onetime.ts`, `protocol.ts`, `authority.ts`, then `kit.ts`, `journal.ts`, `requests.ts`, `passkey.ts`.
7. `tools/recovery/` and `scripts/build-recovery-tool.mjs`.

## One command

`npm ci && npm run check:all` runs every suite in `docs/TESTING.md` on an isolated local validator it starts itself. `npm run check:independent` alone takes a second and shows whether the specification, as you read it, produces the checked-in vectors: `scripts/independent-check.py` is short enough to read beside `docs/PROTOCOL.md`.

## Things to check

- Read `crates/bunker-lmots/src/lib.rs` (the verifier the program runs, about a hundred lines) and `sdk/lmots.ts` beside RFC 8554 section 4. Both are tested against the RFC's Appendix F vectors (`fixtures/rfc8554-test-case-1.json` for verification, `-2.json` for signing), but they share an author: check them against another LM-OTS implementation. Then read `identifier` and `verify_proof` in `programs/bunker3/src/lib.rs` and `sdk/v3/onetime.ts` for how a key is bound to its vault, role, generation and index.
- Trace every account in each instruction: owner, PDA derivation, writability, signer, aliasing between vault, proof, markers and destination.
- Regenerate `fixtures/bunker-v3.json` with `npx tsx scripts/v3-vectors.ts` and compare. The Rust check in `programs/bunker3-svm-tests/tests/client_vectors.rs` re-derives it with a different HKDF implementation.
- The claim that re-emitting the fixed recovery signature is safe (PROTOCOL.md open question 1).
- A zero waiting period being permitted and the interface default (open question 11).
- The journal's crash windows (`sdk/v3/journal.ts`), its behaviour when the chain view goes backwards, and the fact that it cannot see a second device.
- Anything that lets one vault affect another, or lets whoever creates a vault influence it (`programs/bunker3-svm-tests/tests/isolation.rs` holds the cases already tried).
- The offline tool's page policy, and that `sdk/v3/requests.ts` schemas reject any field beyond the public ones.
- `package-lock.json`, `Cargo.lock`, CI permissions and pinned action revisions, the site's CSP, and the RPC proxy's allowlist and bounds.

## Invariants to challenge

- Only `execute` debits a vault, and only what a verified announcement recorded, to that destination, once, not before the vault's waiting period.
- An operational key cannot change the recovery root or invalidate a recovery packet.
- A recovery packet applies to exactly one epoch and can only install the roots it names.
- A retired root is never an authority again in its vault, in either role.
- No instruction on one vault can change whether another vault's `announce` or `recover` succeeds.
- The vault at an address has exactly the roots, chain tag and waiting period its address was derived from.
- A rejected instruction changes nothing.
- The default configuration, client and server, cannot submit a mainnet custody transaction.

## Evidence and its limits

[TESTING.md](TESTING.md) lists every suite, what it covers, what CI does not run, and known gaps. No formal proof, coverage-guided fuzzing campaign, penetration test or completed audit is claimed.

Report privately through the repository's Security tab, not in public issues.
