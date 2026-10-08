# Proposal: recoverable authority and delayed withdrawals

**Status: historical design rationale.** Written 7 October 2026 against an earlier protocol that has since been removed. Sections 1 to 3 were made concrete in [PROTOCOL.md](PROTOCOL.md) and implemented in draft; the waiting period described here as mandatory became optional there; pre-approved destinations (section 4) are not built; an optional alert service (section 6) was built later in a simpler form (`lib/alerts`). Where this document and PROTOCOL.md differ, PROTOCOL.md is current. References below to "protocol 2" or "v2" describe the removed design.

## Decision requested

Review a recovery-first design before implementation: an offline recovery authority, one stable archival secret, authority consumption at announcement, delayed execution with alerts, and optional delayed destination approval. Keep the program without an administrative override, protocol fee recipient or arbitrary calls. Keep Winterwallet revision `672fc6789b1532ee680f24842d235e0be8737b61` unchanged; review its use and the surrounding protocol independently. It is not WOTS+, LMS or XMSS, and this proposal makes no end-to-end post-quantum claim.

Two distinctions govern the design:

- **Rotate-only is not economically powerless.** Whoever can install a withdrawal authority can indirectly control funds. The recovery authority must be treated as a root of trust, kept offline, and prevented from bypassing waiting periods or changing destinations inside the recovery instruction.
- **A fixed backup and a chain nonce do not eliminate one-time state.** Two restored devices can derive the same key while its first signature is unconfirmed. Ordinary variable withdrawal signing still requires durable consumption records and one active signer. Chain state records accepted transitions, not every signature ever produced.

The liveness objective is conditional: **expiry or failure of an ordinary withdrawal must not itself permanently lock assets while the independent recovery authority and supported recovery tool remain available.** Lost or stolen master material, failed chain liveness, compromised recovery tooling, unsafe signatures and defective cryptography remain outside that guarantee. Do not advertise that permanent loss has been eliminated.

## Proposed authority model

| Role | Holds | Permitted action | Explicitly cannot do |
|---|---|---|---|
| Fee payer | Any ordinary Solana wallet | Pay transaction fees and account rent | Authorize vault spending solely with its wallet signature |
| Operational signer | One epoch's operational secret, durable local journal | Authorize exact withdrawals and bounded policy proposals with fresh one-time indices | Derive the next recovery epoch or recovery keys from its operational secret |
| Offline recovery signer | Archival master, fixed vault descriptor, independently checked chain context | Perform one canonical recovery transition per recovery index | Transfer, specify a payment recipient, invoke arbitrary programs, reduce delay floors, or collect a fee |
| Alert service | Public vault address and opt-in delivery destinations | Observe and notify | Sign, hold a recovery file, move assets or decide chain finality |

Proposed vault state adds a recovery commitment/index, an authority epoch, policy version/hash, configured delay, an optional pending-operation record and an optional approval-set root or bounded account set. Keep at most one pending financial/policy operation per vault in the first implementation. Root-spent markers remain permanent. Counters are checked integers; overflow fails closed and is an explicit migration condition.

## 1. Fallback authority: recovery without another expiring withdrawal

### Recommended operation

`recover_and_rotate` is a new operation with its own domain, version and proof layout. Its canonical signed body binds the executing program, immutable vault identity/address and chain descriptor, current recovery index/root, next recovery root, next authority epoch and its initial operational root. **It has no amount, mint, destination, arbitrary instruction, caller-chosen policy, expiry, active nonce or pending-operation id.** A recent Solana blockhash still belongs to the ordinary fee transaction; the hash authorization is independent of that replaceable wrapper.

After verification, one atomic instruction marks the recovery root and displaced operational root spent, advances the recovery index and authority epoch, installs the next operational root, clears any pending withdrawal/address proposal and pauses fast-path approvals. Mark the displaced operational root even if no accepted withdrawal used it: an offline signature might already exist. Both new roots must be distinct, nonzero and globally unused, including across authority roles. It never debits SOL or token balances. It preserves the configured waiting period and mandatory floors. Pausing fast paths is an explicit protective side effect beyond literal root replacement; it must be reviewed as such. Existing approved-address records may remain for display, but cannot skip a delay until explicitly re-approved under the fresh epoch.

An ordinary operational action cannot change the recovery root/index. In particular, an attacker with the operational secret cannot invalidate a prepared recovery packet merely by racing additional operational nonces. Recovery clears all operations in the displaced epoch, rather than signing a mutable pending id. Execution must check the record's epoch, so an old pending operation cannot execute after recovery.

A disclosed old operational root must not be reinstalled; check the same global spent-root records used for normal authority rotation. Role labels must be included in derivation and signatures; a recovery proof must never verify as a withdrawal proof. Recovery proof rent is paid by any clean fee wallet, with no fixed relayer or fee recipient.

The chain descriptor must be immutable vault state and independently pinned by the recovery tool. A Solana program cannot read the genesis hash from the Clock sysvar; a frontend-supplied network label proves nothing. Binding this descriptor separates deliberately different deployments, but does not prevent replay on a fork that copies identical program and vault state. Network verification and that cloned-state boundary must remain explicit; do not claim absolute cross-chain replay immunity.

### Avoid moving the same failure into the fallback key

A variable, expiring one-time recovery signature would simply create a second permanent-lock window. The proposed offline tool instead derives **one deterministic recovery packet for each recovery index**, using only the immutable vault descriptor, that index, and the archival master. The next operational root and next recovery root are derived internally; a frontend cannot supply them. There is no timestamp or selectable destination in this packet.

If a packet upload or fee transaction fails, replay its exact bytes. If the offline tool crashes before saving it, it can reconstruct that identical packet. This is a proposed, narrowly scoped exception to v2's refusal to invoke signing again: the recovery signer has exactly one permitted message at each index. Repeating that identical deterministic signature discloses no second message. This reasoning depends on the actual construction and serialization and requires explicit cryptographic review; it is **not permission to retry arbitrary operational signing**. A generic signing API over the recovery key is prohibited.

The on-chain program can verify the committed recovery key and signed next roots; it cannot infer a secret HKDF derivation or prove that an arbitrary external signer never signed another message. The offline tool's fixed-message restriction and independent integrity verification are therefore real trust assumptions. The review must reject this approach if those assumptions cannot be enforced adequately; consider a separately reviewed many-time recovery authority rather than inventing a new signature scheme. That alternative is not selected or implemented here.

Two devices reconstructing the same recovery packet produce the same transition. Chain serialization permits one success; the other observes the advanced recovery index and does not substitute a different packet at the old index. Ordinary withdrawals and recoveries never reset a derivation tuple. Publishing a recovery packet lets anybody trigger that exact recovery early; this can disrupt operations but cannot redirect the installed authority. Keep unused packets private.

### Failure and review scope

A stolen archival master remains catastrophic: its holder can derive recovery and fresh operational keys. Delay and alerts can provide time to react but cannot cure theft of the root of trust. A revealed recovery signature must authorize only its fixed transition; replay, cross-vault/program/role substitution, counter wrap, duplicate roots, partial allocation and failure rollback all need adversarial tests. Missing archival material, unsupported old formats or a halted/censoring chain can still prevent recovery.

**Mainnet gate:** required recovery/liveness mechanism, independently reviewed offline tool, fixed-message analysis and race tests. No promise that every failure is recoverable before these exist.

## 2. One stable archival backup, with isolated operational material

### Key derivation proposal

Use one uniformly random 256-bit master `M` generated offline. Use the published HKDF-SHA256 construction from [RFC 5869](https://www.rfc-editor.org/rfc/rfc5869), through an established implementation and test vectors. Specify a new, fixed binary context before coding: derivation version, full chain descriptor, program id, vault id, role, authority epoch and one-time index. Prefix lengths or fixed widths must remove ambiguity. HKDF is a KDF, not a replacement signature scheme; its use with Winterwallet still needs review.

The offline tool derives a distinct operational seed for each recovery epoch. An operational signer receives **only that epoch's seed**, from which it derives each 1,088-byte one-time secret using the on-chain index and fixed domain. It cannot derive the master, recovery keys or a later epoch's seed. After recovery, transfer a freshly derived epoch seed to a clean signer. Merely changing a nonce under a stolen operational seed does not remove the attacker.

The archival encrypted kit contains `M`, immutable vault/program/network descriptor, derivation and encryption versions, creation metadata, and authenticated KDF/AEAD parameters. It has no mutable "current secret" and does not need replacement after routine withdrawals. The offline recovery tool reads the chain's epoch/index, derives the expected root, and compares it with chain state before exporting operational material. Root disagreement stops recovery; it must not guess a different path.

This replaces the current "new portable kit per withdrawal" experience. It does **not** remove the operational journal, saved pending signatures or anti-rollback requirements. Do not upload the archival master kit to the everyday web app. A kit imported into a compromised browser exposes both roles and invalidates the separation.

### What the chain can and cannot decide

The chain is authoritative for **accepted** epoch/index/root transitions. For a locally used but unconfirmed operational key, the consumption record and exact pending signature still matter. A backup alone cannot establish that the chain-current operational index is unused. A fresh restore without trustworthy operational state must not derive and sign with that current key: use the independent fixed recovery transition to start a new epoch first.

An operational restore with an intact journal reconciles the exact saved message; an incomplete journal enters recovery, never "try another transfer." Two already provisioned devices in one epoch can still split-brain before either transaction lands. Require a single active durable signer with anti-rollback storage for first mainnet support. Browser locks protect only cooperating tabs; they cannot enforce this across devices or against a malicious signer. Restoring master material onto two devices also expands the compromise surface.

An on-chain intent-reservation protocol could help serialize honest devices before signing, but an unauthenticated reservation can be spammed and a reservation authenticated by the same unused one-time key recreates the race. A separate reservation credential adds a new permission and denial-of-service surface. Do not silently add it to this small-surface design. Multi-device operational signing is deferred until a reviewed architecture addresses this problem.

"One backup for life" is not an unconditional promise. Theft of `M`, cryptographic migration, a new program/network, or a changed derivation format may require deliberate migration and a new kit. The defensible claim is **one archival kit across ordinary operations in a supported vault generation**. Password changes re-encrypt that kit; losing both a readable kit and its password is not fixable by the program.

**Added surface:** off-chain KDF, epoch provisioning, offline recovery application, authenticated immutable descriptor; on-chain epoch/index and root checks. **Mainnet gate:** durable signing and restoration design are required; multiple active devices can follow later. Stable-kit UX should be resolved before the first production cryptographic review, rather than retrofitted as an unaudited convenience.

## 3. Delay, alert and cancel

### State machine

1. **Review/sign:** the operational signer displays full mint, base-unit amount, destination, delay, deadlines, policy version and next commitment; it consumes its journal before producing a signature.
2. **Announce:** verify that signature on-chain, mark the current root spent and rotate to the next operational root immediately. Store one bounded pending record containing the verified transfer, digest, epoch, operation sequence, policy version and execution window. No asset moves. An expired or failed *execution* therefore cannot leave the old revealed authority in charge.
3. **Wait:** expose an inclusive opening time and a separate execution deadline. Default proposed waiting period: 24 hours for unapproved destinations, configurable upward to 7 days. First mainnet version should not allow an unapproved-destination delay below the reviewed 24-hour floor. These are proposed product parameters, not measured security guarantees.
4. **Execute:** permissionless submission of a fixed SOL/classic SPL transfer from the pending record after the opening time and through its deadline. No new hash signature is needed. Check epoch, record identity, token/mint/destination constraints and active policy. Consume the record atomically with the transfer. Failure leaves it retryable until deadline; it does not undo the authority rotation at announcement.
5. **Expire:** permissionlessly clear an expired record, transfer nothing, retain the already advanced operational authority. A lost next operational secret is recovered through the offline master/recovery path.
6. **Cancel:** submit the fixed `recover_and_rotate` packet from the **separate current, unspent recovery commitment**. It clears the pending record and installs fresh operational and recovery authorities. It never signs a second message with the consumed withdrawal key or signs variable pending ids under one recovery key.

A withdrawal that failed *before announcement committed* still needs fallback recovery because its operational signature may have been disclosed. The fallback path covers that distinction. The first design blocks another operational announcement while one record is pending, avoiding amount reservation across multiple operations and reducing accounting surface.

Use Solana's Clock sysvar for consensus-enforced time, not browser time. A later protocol can encode reviewed Unix-time deadlines in seconds; a slot is not a guaranteed fraction of a second. Time arithmetic, drift, halted chains and inclusive boundary rules must be specified and tested. A delay starts when the announcement lands, not when a user clicks or a service sends mail.

### Cancel is a race with execution

Before eligibility, execution must fail. After eligibility, a cancel/recovery transaction and execution can race; chain ordering decides. If cancel commits first, epoch and record checks invalidate execution. If execution commits first, recovery can protect only the remainder. Never describe cancel as undoing an executed transfer or promise notification delivery before execution. Even within the wait, censorship or network failure can keep a user's cancel from landing.

Alerts are a necessary operational layer for the intended compromise-response benefit, but do not gate chain execution on receipt or trust a notification provider's signature. No provider has an administrative key. A future cancel-only guardian could improve response time, but adds a denial-of-service authority and needs a separate design; it is outside this proposal's first implementation.

**Added surface:** announce/execute/expire state machine, a fixed-size pending account, time checks, recovery cancellation and public events. **New failures:** unavailable alert delivery, offline recovery access too slow, clock assumptions, account rent exhaustion, missing funds/token freeze at execution and race outcomes. **Review:** no transfer before eligibility; no changed field at execution; at-most-once completion; cancellation at boundary slots/timestamps; announcement/execute failures; recovery racing every state; staged signature front-running; stale policy versions. **Mainnet gate:** required if the product intends to claim a response window for theft of the operational key.

## 4. Pre-approved destinations

Treat this as an optional convenience that weakens the waiting protection for explicitly chosen destinations. Default: disabled. Recommend deferring the bypass until the recovery/delay core is reviewed; design and audit the full feature if it ships in the initial production release.

An approval identifies the exact chain/program/vault, asset kind, mint and destination account. For SOL use the public key; for classic SPL use the exact token account plus expected owner, mint and token program, revalidated on execution. Never match an address prefix, UI label, mutable address-book alias or arbitrary remaining account. Start with at most 16 entries or another justified audited bound; per-entry accounts simplify bounded reads but add rent and account validation.

Adding or re-enabling an address is an operational one-time authorization: consume/rotate at proposal, then wait **at least 48 hours and no less than the existing withdrawal delay** before permissionless activation. It has a unique id, epoch and policy version. Announce it to all alert channels. Offline recovery during the wait clears the proposal and pauses all bypasses. No add-and-spend in one transaction can bypass activation time. An address removed/re-added or an owner/mint changed must go through fresh checks and delay.

Once active, an exact matching withdrawal may announce and execute with zero waiting time; both still need fixed-record validation, fresh one-time authorization and one successful transfer. Zero wait does not mean no signature, no record or unlimited access. If execution fails, the same exact pending record remains available through its deadline; recovery remains possible. The first implementation can require two transactions even for zero-delay execution rather than hiding a more complex atomic fast path.

A compromised approved recipient can be drained immediately. Approving the everyday fee wallet may undermine the reason to separate a vault in the first place; onboarding must make this consequence explicit and recommend an independently controlled destination. Recovery cannot retrieve funds already sent there. Recovery's automatic pause avoids carrying an unsafe bypass silently into a fresh signer epoch. A selective instant revoke is not part of the fixed recovery packet; until separately designed, recovery pauses **all** approvals.

**Added surface:** propose/activate approval instructions, bounded membership data, per-asset destination checks, policy generation and bypass pause. **Review:** pending-address cancellation, stale activation, token account close/recreate or owner change, account substitution, duplicate entries, counter overflow and delay downgrade paths. **Mainnet gate:** optional; any bypass enabled at launch requires full review, alerts and clear consent.

## 5. Longer expiry: immediate proposal, not a change in this PR

Until fallback exists, propose an **estimated 7-day authorization window**, expressed in days/hours with an explicit absolute deadline and a countdown, rather than a raw slots field. Do not shorten an already signed intent or regenerate it when time runs low. Allow advanced users to inspect the signed slot value. Warn before signing that expiry can still permanently lock a protocol-2 vault; a longer window reduces accidental expiry but does not solve liveness and leaves a disclosed authorization executable longer.

V2 enforces slots, so the UI must label the duration an **estimate**. For a concrete initial conversion, 7 days at a nominal 400 ms per slot is 1,512,000 slots; this is an assumption for a reviewed UI setting, not a guarantee or a measured chain speed. Display the exact expiry slot too, with elapsed-slot progress and a clearly approximate wall-clock estimate. The current SDK/UI limit would need deliberate review if this value is later implemented. Never silently describe slot expiry as exactly seven days. Test slow/fast slot progression, stalled chain, unsafe numeric values, overflow, browser clock error and resume near expiry.

For the later delayed design, separate **announcement expiry** (proposed 7-day default) from **execution deadline** (proposed 7 days after the waiting period opens). Both need independent labels, signed binding and overflow-safe validation. Expired announcement uses recovery; expired execution clears the record with the already advanced authority intact. No default is changed by this document.

**Added surface:** initially UI conversion/countdown only; later new signed time fields and Clock checks. **Mainnet gate:** a humane reviewed window is necessary, but cannot substitute for fallback. Product time defaults may be tuned in later releases within audited bounds; no mainnet custody environment switch is introduced.

## 6. Alert and event contract

Events are versioned factual records, never audit attestations. Every program event includes schema version, program/vault identity, operation id/sequence, authority epoch, slot/chain timestamp and relevant policy version. Indexers associate transaction signature and instruction index externally; never trust a self-reported signature in event data. Logs from failed transactions must not be presented as committed state changes.

| Event | Extra fields | Expected notification |
|---|---|---|
| Deposit observed | Asset/mint/account, balance delta or known incoming transfer, source if actually attributable | Deposit received; label uncertain attribution |
| Withdrawal announced | Exact mint/destination/amount, announcement digest, eligibility time, deadline | Immediate notice and time available to respond |
| Withdrawal completed | Operation id, actual transfer fields, resulting state version | Completion, with link to inspect chain state |
| Withdrawal cancelled | Operation id/epoch invalidated by recovery, recovery sequence | Cancelled only after observing accepted cancellation |
| Authority rotated | Role, old/new commitment fingerprints, indices/epochs, reason | Distinguish announce rotation from offline recovery |
| Address approval proposed/activated | Exact tuple, activation time, approval generation | Separate proposal warning and activation confirmation |
| Pending operation expired / fast paths paused | Operation id, reason and remaining policy | Explain next safe action; no request for secret material |

**Direct deposits do not execute the Bunker program.** It cannot emit a reliable deposit event for a plain System/SPL transfer. Keep deposits direct to preserve the small program surface. The indexer observes known vault/associated-token accounts and supported transfer instructions or balance changes. Cover unsolicited tokens, multiple transfers per transaction, native rent movements, token account creation/closure and newly discovered token accounts. If attribution is unavailable, report a balance change rather than inventing a sender. A program deposit wrapper would add surface and still would not cover direct transfers; it is not proposed as a complete solution.

Subscribe for low-latency notifications, then backfill from durable RPC history on reconnect. Store an idempotency key such as `(cluster, transaction, instruction, event ordinal)` plus observed commitment level; deduplicate retries, publish rollback/correction notices and distinguish provisional from finalized status. Maintain a cursor, monitor indexing lag and channel delivery failures, and provide a visible service-health heartbeat. A silent inbox must not imply that monitoring is healthy. RPC retention and missed slots are operational dependencies, so retain public event/state history independently with bounded privacy policies.

At least one opt-in channel with tested delivery, retry and outage procedures is a mainnet gate for the advertised delay/response workflow. Additional email/push/chat channels and subscriptions can follow. Enrollment must verify control of the delivery destination; changing contacts should notify old and new channels. Do not put contact details or secrets on-chain. Messages should show the full destination and public operation id, link only to the documented official site, and state: **"Bunker will never ask for your recovery kit by message."** No email link directly imports, unlocks or uploads a kit.

## 7. Review plan and implementation boundary

| Work item | Required before real funds? | Added surface | Mandatory evidence |
|---|---|---|---|
| Independent recovery authority | Yes | New role/root, canonical recovery transition, epoch invalidation | Fixed-message reconstruction, old-proof replay, races, failed recovery CPI, stolen-role analysis |
| Stable archival kit and isolated signer | Yes, settle the architecture before review | HKDF/context, epoch provisioning, offline recovery, durable state | Independent vectors, root matching, crash/rollback/device tests, master never handled by routine frontend |
| Delay / cancel | Yes for the intended response-window protection | Pending record, Clock checks, execute/expire/recover transitions | Full state-machine model, boundary ordering, frozen assets, no early execution or double transfer |
| Basic alerts | Yes for that product promise | Indexer, enrollment, delivery and outage operations | Direct-deposit coverage, reorg/backfill tests, delivery drills, public degraded status |
| Approved-address bypass | Can follow; off by default | Delayed policy proposals, membership, epoch pausing | No add-and-spend shortcut; owner/mint substitution and compromised-recipient scenarios |
| Longer expiry / understandable time | Yes as usable policy; does not solve recovery | UI conversion, then separate time fields | Exact signed bytes, clocks/overflow, near-expiry retry and no re-signing |
| Multi-device operational signing / cancel guardian | Can follow | New synchronization or permission model | Separate reviewed design; never implied by a static backup or an alert subscription |

Before code, agree on the recovery packet's exact immutable inputs, permission effects, derivation context, one-active-signer rule, role separation, time units/floors, pending-operation capacity and approval semantics. Then model the transition system and enumerate invalid interleavings. Only then freeze byte layouts and implement local-only tests, including independent fixtures. Scope the cryptographic and program reviews against that final behavior. One coordinated audit scope is a planning goal; findings or later changes may still require another review.

There is no v2 in-place migration selected. A later reviewed version must publish an explicit source change, migration/recovery tooling, independent findings and remediation, reproducible binary evidence, upgrade policy and a launch decision. Protocol fees, privileged administrative control, arbitrary invocation and a dependency on any unrelated asset are outside this proposal. Fees/account creation and the Solana runtime retain conventional signature dependencies.

## Primary references and limits of prior art

- [RFC 5869](https://www.rfc-editor.org/rfc/rfc5869) specifies HKDF; it does not establish this protocol's one-time state safety.
- [Solana transactions](https://solana.com/docs/core/transactions) describes ordinary transaction signatures and atomicity; rollback does not retract a disclosed signature.
- [Clock crate](https://docs.rs/solana-clock/2.2.3/solana_clock/struct.Clock.html) documents the slot and Unix-time fields used when selecting time semantics.
- [Winterwallet pinned source](https://github.com/blueshift-gg/winterwallet/tree/672fc6789b1532ee680f24842d235e0be8737b61) is unchanged prior art, not an independent review of Bunker.

All selected defaults and transitions above are proposals. No test result from protocol 2 is evidence that this proposed design is implemented or safe.
