# Protocol 3: draft byte-level specification

**Status: draft for design review. Not implemented, not approved, not audited.** 7 October 2026. It makes `docs/RECOVERY-POLICY-PROPOSAL.md` concrete enough to review and to implement against: accounts, instructions, signed bytes, derivation and a transition table. Where the proposal left a choice open, this draft picks one and lists it under [Open questions](#open-questions). Nothing here changes protocol 2, the release gate or any deployed behaviour. Real-fund custody remains disabled.

A draft implementation of this document is in `programs/bunker3` (see [Implementation status](#implementation-status)). It exists so the design can be reviewed against running code; it is not deployed and the web app does not use it.

Scope of this draft: the recovery authority (proposal §1), the stable archival secret (§2) and delayed withdrawals with cancel-by-recovery (§3). Pre-approved destinations (§4) and the alert service (§6) are out of scope; the vault layout reserves no space for them and a later version must be a new, reviewed layout.

Unchanged from protocol 2: the vendored Winterwallet verifier at revision `672fc6789b1532ee680f24842d235e0be8737b61`, N=32, 1,088-byte signatures, two-chunk proof staging, direct deposits, no administrator, no fee recipient, no arbitrary invocation, SOL and classic SPL only.

## 1. Roles and secrets

| Secret | Size | Lives | Derives | Signs |
|---|---|---|---|---|
| Archival master `M` | 32 bytes, CSPRNG | Offline recovery kit only | Every recovery key and every epoch seed | Nothing directly |
| Recovery key `R[e]` | 1,088 bytes | Derived offline on demand | — | Exactly one message: the recovery packet for epoch `e` |
| Epoch seed `S[e]` | 32 bytes | Operational signer for epoch `e` | Operational keys of epoch `e` only | Nothing directly |
| Operational key `K[e][i]` | 1,088 bytes | Derived by the operational signer | — | At most one withdrawal announcement |

`e` is the authority epoch, a u64 that starts at 0 and increases by one on every recovery. It is also the recovery index: there is exactly one recovery key per epoch. `i` is the operational index within the epoch, a u64 that starts at 0 on every epoch and increases by one on every accepted announcement. The pair `(e, i)` is never reused.

### 1.1 Derivation

HKDF-SHA256 (RFC 5869) with an empty salt. All integers are unsigned little endian. `ctx` is a fixed 109-byte prefix:

```
ctx = "BUNKER-KDF-3" (12) || 0x00 || chain_tag (32) || program_id (32) || vault_id (32)   // 109 bytes
```

| Output | IKM | info | Length |
|---|---|---|---|
| `R[e]` | `M` | `ctx || 0x01 || e (8)` | 1,088 |
| `S[e]` | `M` | `ctx || 0x02 || e (8)` | 32 |
| `K[e][i]` | `S[e]` | `ctx || 0x03 || e (8) || i (8)` | 1,088 |

The role byte makes the three derivations disjoint. 1,088 bytes is within HKDF-SHA256's 8,160-byte limit. `root(x)` is the existing Winternitz Merkle commitment of a 1,088-byte secret (`rootFromSecret`). An operational signer holding `S[e]` cannot compute `M`, any `R`, or `S[e+1]`.

## 2. Accounts

### 2.1 Vault — 287 bytes, PDA `["bunker3", vault_id]`

| Offset | Bytes | Field |
|---|---:|---|
| 0 | 8 | Magic `BUNKER03` |
| 8 | 32 | `vault_id`, immutable |
| 40 | 32 | `chain_tag`, immutable; see §6 |
| 72 | 32 | `op_root` = `root(K[epoch][op_index])` |
| 104 | 8 | `op_index` |
| 112 | 8 | `epoch` |
| 120 | 32 | `rec_root` = `root(R[epoch])` |
| 152 | 4 | `delay_secs`, immutable in this version; 0 ≤ value ≤ 604,800. Zero means no waiting period |
| 156 | 1 | `pending`: 0 = none, 1 = present |
| 157 | 1 | pending `kind`: 0 = SOL, 1 = classic SPL |
| 158 | 32 | pending `mint` (zero for SOL) |
| 190 | 32 | pending `destination` (token account for SPL) |
| 222 | 8 | pending `amount` |
| 230 | 8 | pending `opens_at`, i64 Unix seconds |
| 238 | 8 | pending `deadline`, i64 Unix seconds |
| 246 | 8 | pending `epoch` at announcement |
| 254 | 32 | pending `digest`, SHA-256 of the announced message |
| 286 | 1 | PDA bump |

When `pending` is 0, bytes 157..286 must be zero. The vault is never closed. At most one pending record exists.

### 2.2 Proof — unchanged, 1,162 bytes, PDA `["proof", payer, digest]`

Magic becomes `BKPROOF3`. Layout, two-chunk staging, identical-chunk retry and payer-only close are as in protocol 2. A proof account carries a signature; it never carries authority.

### 2.3 Spent marker — 8 bytes, PDA `["spent-v3", root]`

Magic `BKSPENT3`, never closable. One namespace for both roles: a root that has been an operational root can never become a recovery root and the reverse.

## 3. Signed messages

Both messages are `domain || program_id (32) || vault_address (32) || payload`. The verifier recomputes the message from instruction data and account keys; nothing is trusted from the proof account except the signature bytes and the digest.

### 3.1 Announcement — domain `BUNKER3_ANNOUNCE` (16 bytes), payload 195 bytes

| Offset | Bytes | Field |
|---|---:|---|
| 0 | 1 | Version `0x03` |
| 1 | 1 | Role `0x01` |
| 2 | 32 | `vault_id` |
| 34 | 32 | `chain_tag` |
| 66 | 8 | `epoch` |
| 74 | 8 | `op_index` |
| 82 | 1 | `kind` |
| 83 | 32 | `mint` (zero for SOL) |
| 115 | 32 | `destination` |
| 147 | 8 | `amount`, > 0 |
| 155 | 8 | `announce_by`, i64 Unix seconds, > 0 |
| 163 | 32 | `next_op_root` = `root(K[epoch][op_index + 1])`, nonzero |

Signed by `K[epoch][op_index]`. Total message 275 bytes.

### 3.2 Recovery packet — domain `BUNKER3_RECOVER_` (16 bytes), payload 138 bytes

| Offset | Bytes | Field |
|---|---:|---|
| 0 | 1 | Version `0x03` |
| 1 | 1 | Role `0x02` |
| 2 | 32 | `vault_id` |
| 34 | 32 | `chain_tag` |
| 66 | 8 | `epoch` (the epoch being left) |
| 74 | 32 | `next_rec_root` = `root(R[epoch + 1])`, nonzero |
| 106 | 32 | `next_op_root` = `root(K[epoch + 1][0])`, nonzero |

Signed by `R[epoch]`. Total message 218 bytes. **Every byte is a function of `M`, the immutable vault descriptor and `epoch`.** There is no amount, destination, time, operational index or pending identifier. For a given vault and epoch there is exactly one valid packet, and reconstructing it yields identical bytes.

The two domains have equal length and differ in content; the role byte differs; the payload lengths differ. A signature for one message type cannot verify as the other.

## 4. Instructions

Opcode is the first byte of instruction data. Any account count, data length, version, role or enum value other than those listed fails. All arithmetic is checked; overflow fails closed. `now` is `Clock::unix_timestamp`.

| Op | Name | Signers | Summary |
|---:|---|---|---|
| 0 | `initialize` | fee payer | Create the vault with both roots and a delay |
| 1 | `stage` | fee payer | Append signature bytes to a proof account (as protocol 2) |
| 2 | `announce` | fee payer | Verify an operational signature, rotate it, record a pending withdrawal; moves nothing |
| 3 | `execute` | fee payer | Carry out the pending withdrawal inside its window; permissionless |
| 4 | `expire` | fee payer | Clear a pending withdrawal past its deadline; permissionless |
| 5 | `recover` | fee payer | Verify the recovery packet, install a new epoch, clear any pending withdrawal |
| 6 | `close_proof` | proof payer | Reclaim proof rent (as protocol 2) |

### 4.0 `initialize` — data: `vault_id (32) || chain_tag (32) || op_root (32) || rec_root (32) || delay_secs (4)`

Requires `op_root ≠ rec_root`, both nonzero, both spent markers absent, delay within bounds. Creates the vault with `op_index = 0`, `epoch = 0`, `pending = 0`. As in protocol 2, a prefunded PDA must not block creation, and no wallet key gains any authority over the vault.

### 4.2 `announce` — data: the 195-byte payload

Checks, in order:

1. Vault owner, length, magic; PDA re-derived from stored `vault_id` and bump.
2. Payload version and role; `vault_id`, `chain_tag`, `epoch`, `op_index` equal the stored values.
3. `pending == 0`.
4. `now ≤ announce_by`.
5. `amount > 0`; `kind ≤ 1`; `mint` zero iff SOL; `destination` is not the vault, proof or either marker.
6. `next_op_root` nonzero, differs from `op_root` and `rec_root`, marker absent.
7. Proof account owner, magic, full length, and digest equal to SHA-256 of the recomputed message.
8. Signature verifies against `op_root`.

Effects, atomically: create the spent marker for `op_root`; set `op_root = next_op_root`; `op_index += 1`; write the pending record with `opens_at = now + delay_secs`, `deadline = opens_at + 604,800`, `epoch`, `digest`. **No lamports or tokens move.** The destination's present state is not validated here; it is validated at execution.

### 4.3 `execute` — no data

Requires `pending == 1`, pending `epoch == epoch`, `opens_at ≤ now ≤ deadline`, and the supplied destination (and for SPL the mint and source) equal to the record. Performs the same SOL or classic SPL transfer and the same owner, mint, delegate, close-authority and rent checks as protocol 2's withdrawal, signed by the vault PDA. On success zeroes the pending record. On failure nothing changes and it may be retried until `deadline`. No hash signature is involved.

### 4.4 `expire` — no data

Requires `pending == 1` and `now > deadline`. Zeroes the pending record. Moves nothing and leaves the authority as it is.

### 4.5 `recover` — data: the 138-byte payload

Checks: vault as above; payload version and role; `vault_id`, `chain_tag` and `epoch` equal the stored values; `next_rec_root` and `next_op_root` nonzero, distinct from each other and from the current `op_root` and `rec_root`, both markers absent; proof digest; signature verifies against `rec_root`.

Effects, atomically: create spent markers for `rec_root` **and** the displaced `op_root` (an offline signature under it may exist even if it was never announced); set `rec_root = next_rec_root`, `op_root = next_op_root`, `op_index = 0`, `epoch += 1`; zero any pending record. **Never debits the vault.** There is no time condition: recovery is valid before, during and after a waiting period.

## 5. Transition table

State is `(epoch e, op_index i, pending P)`. Every row not listed fails with no state change.

| From | Instruction | Guard | To |
|---|---|---|---|
| `(e, i, none)` | `announce` signed by `K[e][i]` | `now ≤ announce_by` | `(e, i+1, P)` |
| `(e, i, P)` | `announce` | — | fails: one pending operation |
| `(e, i, P)` | `execute` | `P.epoch = e`, `opens_at ≤ now ≤ deadline`, transfer succeeds | `(e, i, none)`, assets moved once |
| `(e, i, P)` | `execute` | `now < opens_at` or `now > deadline` | fails |
| `(e, i, P)` | `expire` | `now > deadline` | `(e, i, none)` |
| `(e, i, any)` | `recover` signed by `R[e]` | — | `(e+1, 0, none)` |
| `(e, i, any)` | `recover` signed by `R[e']`, `e' ≠ e` | — | fails |

Consequences to check against the implementation:

1. **No transfer before the vault's own waiting period.** The only instruction that debits the vault is `execute`, which requires `now ≥ announced_at + delay_secs`. The waiting period is chosen when the vault is created and cannot change. **It may be zero**, in which case `announce` and `execute` can share one transaction and properties 4 and the cancel path below give no reaction time; see [The waiting period is optional](#the-waiting-period-is-optional).
2. **At most one transfer per announcement.** `execute` zeroes the record in the same instruction as the transfer.
3. **No field changes between announcement and execution.** `execute` takes no data; every transfer field comes from the record.
4. **Recovery always wins over a pending withdrawal that has not executed.** It zeroes the record; a stale `execute` then fails on `pending == 0`.
5. **A disclosed root is never reinstalled**, in either role, in any vault under this program.
6. **An operational key cannot block recovery.** The packet for epoch `e` depends on no operational state. Announcements change `op_root` and `op_index` only.
7. **Expiry never strands the vault.** An announcement that is signed but not landed by `announce_by`, an execution that never succeeds, and a lost epoch seed all leave `recover` available while `M` exists.

Races that chain ordering decides, and that the product must describe honestly: `execute` against `recover` after `opens_at` (if `execute` lands first, the transfer stands and recovery protects only the remainder); two devices submitting the same recovery packet (one succeeds, the other fails on `epoch`).

## The waiting period is optional

A vault is created with `delay_secs` anywhere from 0 to 7 days, and the reference interface defaults to 0 and requires an explicit, separately acknowledged choice to set one. This is a product decision: a mandatory 24-hour hold on every withdrawal was judged unacceptable as a default.

What changes with `delay_secs = 0`:

- **Unchanged:** a wallet key alone cannot withdraw; the announcement must be signed by the current one-time operational key; the signed fields fix the amount, asset and destination; the key rotates on use; retired roots are never reinstalled; a lost or exposed day key, an expired announcement and an interrupted signing are all recoverable with the archival kit.
- **Lost:** the reaction window. Whoever holds a valid day key and its password can announce and execute in a single transaction. Recovery can still replace the keys, but only before a theft, not during one.

A vault with a waiting period keeps every property in the table above. The interface states this difference at creation, and a vault's setting is visible on its page. Whether the first reviewed release should permit zero, and whether the choice should be changeable later through a delayed policy operation, are open questions 5 and 11.

## 6. `chain_tag`

A Solana program cannot read the genesis hash. `chain_tag` is 32 bytes chosen at initialization and immutable; the reference client sets it to the cluster's genesis hash and the offline tool refuses to derive or sign unless the tag it is given matches the cluster it has independently pinned. It separates deliberately distinct deployments in derivation and in signed bytes. It does **not** prevent replay on a fork or a cloned ledger that copies identical program and vault state, and the program cannot detect a wrong tag at initialization.

## 7. Off-chain rules that the chain cannot enforce

These are trust assumptions, not program guarantees.

1. The recovery tool exposes no general signing interface. Its only output for epoch `e` is the packet in §3.2, built from derived values. The claim that re-deriving and re-emitting the identical packet is safe rests on the message being byte-identical; it must be reviewed against the actual Winternitz construction.
2. `M` never enters the everyday web application. The operational signer receives `S[e]` only.
3. One active operational signer per epoch, with a durable record written before signing. Two devices holding `S[e]` can still sign two different announcements at the same `(e, i)`; the chain accepts at most one, and the correct response to any doubt is `recover`, never a second signature.
4. A restore without a trustworthy operational record must not sign with `K[e][i]`. It recovers to `e + 1` first.

## 8. Evidence required before implementation is called complete

- Independent derivation vectors for `R`, `S`, `K` and both message encodings, generated by Rust and checked by TypeScript and the reverse.
- For every row of §5 and every failing combination: a local-validator test, including boundary seconds at `announce_by`, `opens_at` and `deadline`.
- Cross-role and cross-vault substitution: an announcement proof submitted to `recover` and the reverse; a packet for another vault, program, `chain_tag` or epoch.
- Recovery racing each state: before announcement, during the wait, at `opens_at`, after `deadline`, and in the same slot as `execute`.
- Root reuse: `next_op_root` or `next_rec_root` equal to any current or spent root, and to each other.
- Failed `execute` (frozen destination, closed token account, insufficient rent) leaves the record intact and retryable; `recover` then clears it.
- Counter limits at `u64::MAX` for `epoch` and `op_index`; `opens_at` and `deadline` overflow.
- Compute-unit measurements for `announce` and `recover` (one verification each, one and two marker creations).

## Implementation status

`programs/bunker3` implements sections 2 to 5: `src/state.rs` holds the layouts and every transition as pure functions; `src/lib.rs` holds account validation, signature verification, spent markers and transfers. `sdk/v3` is the TypeScript client: `derive.ts` (section 1.1), `protocol.ts` (encodings, vault parsing and instruction builders) and `authority.ts` (the fixed recovery packet and announcement signing from an epoch seed). `sdk/v3/kit.ts` defines the two key files (archival kit and day key), `sdk/v3/journal.ts` the operational signing journal, and `sdk/v3/chain.ts` the vault and clock reads. A draft web interface exists: the rebuilt `/vault` (open with a day key, deposit, announce, countdown, release, clear, seal) and `/recovery`, which only submits public files. **The archival master is handled only by the offline recovery tool** (`tools/recovery`, built by `scripts/build-recovery-tool.mjs` into one self-contained HTML file). Its own Content Security Policy sets `default-src 'none'` and `connect-src 'none'` and pins the inline script by hash; the build publishes the file's SHA-256. The tool and the site exchange three public file types defined in `sdk/v3/requests.ts`: a network card (site to tool), a creation request (two commitments and the waiting period) and a recovery packet (payload and signature). The site verifies a packet's signature against the on-chain recovery commitment before submitting it. Remaining gaps for this separation: the tool is served from the same domain as the site, so a compromised site could serve a different file, and only the published hash and reproducible build let a user detect that; the day key is still opened in the site's origin by design; and a browser on an online device is not an air gap. SOL only in the interface; the program's classic SPL path has no interface yet.

| Evidence | Where | Count |
|---|---|---:|
| Transition table, encodings, boundaries and overflow against the pure state logic | `programs/bunker3/tests/state.rs` (`cargo test -p bunker3`) | 16 |
| The compiled SBF binary in an in-process Solana VM with a controlled clock | `programs/bunker3-svm-tests` (standalone crate; see `docs/TESTING.md`) | 20 |
| TypeScript client: RFC 5869 vector, context layout, role and epoch separation, encodings, instruction shapes, and byte-for-byte reproduction of `fixtures/bunker-v3.json` | `tests/protocol-v3.test.ts` (`npm test`) | 14 |
| The client's vectors against an independent Rust derivation (RustCrypto HKDF), the vendored verifier, and the compiled program (create, announce, recover, announce in the next epoch) | `programs/bunker3-svm-tests/tests/client_vectors.rs` | 3 |

The second suite covers: nothing leaving before `opens_at` and exactly once after; the inclusive `announce_by`, `opens_at` and `deadline` seconds; permissionless execution; expiry leaving the authority usable; recovery when idle and while a withdrawal is pending; both displaced roots retired; a recovery packet bound to its epoch; cross-role proof substitution; altered payload bytes; retired roots refused as any next root and as a new vault's root; the rent reserve; a forged vault account; proof staging and close; and a classic SPL withdrawal including a frozen destination that later thaws.

Each of the following checks was removed in turn and the suite confirmed to fail: the waiting period, signature verification, clearing the record on recovery, retiring the displaced operational root, the vault PDA check, clearing the record after execution, destination binding, and the next-root marker check.

Measured on that VM with the 1,400,000-unit limit: `announce` about 594,000 compute units, `recover` about 639,000.

| Public file formats (rejecting secrets, mismatched vaults, a packet whose stated epoch differs from its signed payload, and signatures from another master) and the tool page's policy | `tests/requests-v3.test.ts` | 5 |
| Signing journal and key files: one signature per key, racing tabs, an orphaned reservation, chain advance, file confusion and tampering | `tests/journal-v3.test.ts` | 10 |
| Browser, against a local validator running this program: build, deposit, announce (state and balances asserted on-chain), countdown, cancel by recovery, dead old day key, announce with the new key, seal | `tests/browser/custody3.spec.ts` | 1 × desktop and mobile |

In the browser suite the offline tool is opened as a local `file://` page, every file passes between it and the site through the filesystem, and the suite asserts the tool page issued no network request. The browser suite has two cases: a vault with no waiting period, where a withdrawal arrives on the third approval, and a vault that opted into 24 hours. It cannot let 24 hours pass, so releasing after a wait is exercised only by the VM suite.

The client and the Rust check share one author and one reading of this document; agreement between them shows consistency, not correctness of the design.

Known gaps: no fuzzing; no validator-level test of the same binary; no independent implementation of the encodings; SPL coverage is one scenario. None of this is an audit.

## Open questions

Each is a decision this draft made provisionally and wants challenged.

1. **Deterministic recovery signature.** Is one fixed message per recovery key, re-emitted byte-identically, acceptable for this Winternitz construction, including after a crash between derivation and submission? If not, the recovery role needs a different, separately reviewed scheme.
2. **`epoch` doubles as the recovery index.** It removes a counter and a class of mismatch. Is there a case that needs them to diverge?
3. **`announce_by` at all.** Announcement rotates the operational root, so an unlanded announcement leaves the on-chain root unchanged and the off-chain key consumed; `recover` resolves that. Dropping the field would remove a time check but let an old signed announcement land at any later time.
4. **Unix seconds rather than slots.** `Clock::unix_timestamp` is validator-reported and can drift. A waiting period of an hour or more is large relative to plausible drift; the boundary tests in §8 should state the assumed bound.
5. **Immutable `delay_secs`.** Changing the delay is a policy operation with its own delay and is deferred. Is a fixed per-vault delay acceptable for a first release?
6. **Fixed 7-day execution window** as a program constant rather than a signed field.
7. **Permissionless `execute`.** It means the fee wallet is not needed at execution and alerts cannot be bypassed by withholding; it also means anyone can complete an announced transfer the moment it opens. The alternative binds execution to a signer and reintroduces a liveness dependency.
8. **One spent-marker namespace for both roles**, and marking the displaced operational root on recovery even when it was never used.
9. **No migration from protocol 2.** Vaults are created fresh under a new program id.
10. **`chain_tag` is client-asserted.** Is a mismatch at initialization detectable in any stronger way worth its cost?
11. **A zero waiting period is permitted and is the interface default.** It removes the reaction window for a stolen day key in exchange for withdrawals that complete at once. Should a reviewed release allow it, allow it only below a balance, or require a minimum?
