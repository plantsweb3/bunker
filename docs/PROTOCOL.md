# Bunker protocol: byte-level specification (draft)

**Status: not audited. Deployed on Solana mainnet as a public beta on 2026-10-09 (docs/DEPLOYMENT.md), as specified here.** This is the only protocol in this repository. The protocol version byte is `0x03`; versions 1 and 2 were earlier experiments with a different design (no recovery authority, a new backup after every withdrawal) and have been removed. `docs/RECOVERY-POLICY-PROPOSAL.md` is the design rationale this document made concrete. It holds real funds.

The implementation is `programs/bunker3` (on-chain), `sdk/v3` (client), `tools/recovery` (offline tool) and `components/bunker/v3` (web app); see [Implementation status](#implementation-status).

Scope of this draft: the recovery authority (proposal §1), the stable archival secret (§2) and delayed withdrawals with cancel-by-recovery (§3). Pre-approved destinations (§4) and the alert service (§6) are out of scope; the vault layout reserves no space for them and a later version must be a new, reviewed layout.

Fixed points: LM-OTS one-time signatures as specified in RFC 8554 section 4, parameter set `LMOTS_SHA256_N32_W8` (§1.3), 1,124-byte signatures, two-chunk proof staging (a 1,124-byte signature does not fit one transaction), direct deposits, no administrator, no fee recipient, no arbitrary invocation, SOL and classic SPL only.

## 1. Roles and secrets

| Secret | Size | Lives | Derives | Signs |
|---|---|---|---|---|
| Archival master `M` | 32 bytes, CSPRNG | Offline recovery kit only | Every recovery key and every epoch seed | Nothing directly |
| Recovery key `R[e]` | 1,120 bytes | Derived offline on demand | — | Exactly one message: the recovery packet for epoch `e` |
| Epoch seed `S[e]` | 32 bytes | Operational signer for epoch `e` | Operational keys of epoch `e` only | Nothing directly |
| Operational key `K[e][i]` | 1,120 bytes | Derived by the operational signer | — | At most one withdrawal announcement |

`e` is the authority epoch, a u64 that starts at 0 and increases by one on every recovery. It is also the recovery index: there is exactly one recovery key per epoch. `i` is the operational index within the epoch, a u64 that starts at 0 on every epoch and increases by one on every accepted announcement. The pair `(e, i)` is never reused.

### 1.1 Derivation

HKDF-SHA256 (RFC 5869) with an empty HKDF salt. All integers are unsigned little endian. `ctx` is a fixed 241-byte prefix:

```
ctx = "BUNKER-KDF-4" (12) || 0x00 || chain_tag (32) || program_id (32) || salt (32) || delay_secs (4) || trusted (4 x 32)   // 241 bytes
```

`salt` is 32 random bytes chosen when the recovery kit is made. It is not secret: it is published in `initialize`. It stands where an earlier draft used `vault_id`, because `vault_id` is now computed from the derived roots (§1.2) and cannot also be an input to deriving them. `delay_secs` and the trusted list (§2.1) are included so that the context holds every input of the vault identity other than the roots: a given recovery key can then only ever sign for one vault. The label `BUNKER-KDF-4` also fixes the message formats in §3; a change to either format needs a new label, so that an existing recovery key is never asked to sign a second encoding.

| Output | IKM | info | Length |
|---|---|---|---|
| `R[e]` | `M` | `ctx || 0x01 || e (8)` | 1,120 |
| `S[e]` | `M` | `ctx || 0x02 || e (8)` | 32 |
| `K[e][i]` | `S[e]` | `ctx || 0x03 || e (8) || i (8)` | 1,120 |

The role byte makes the three derivations disjoint. 1,120 bytes is within HKDF-SHA256's 8,160-byte limit. A one-time key is the 34 LM-OTS chain starts `x[0..33]` (1,088 bytes) followed by a 32-byte randomizer seed (§1.3). An operational signer holding `S[e]` cannot compute `M`, any `R`, or `S[e+1]`.

### 1.2 Vault identity

```
vault_id = SHA-256( "BUNKER3_VAULT_ID" (16) || salt (32) || chain_tag (32) || op_root (32) || rec_root (32) || delay_secs (4) || trusted (4 x 32) )
```

The preimage after the domain is exactly the data of `initialize` (§4.0). The program computes `vault_id` itself and derives the vault address from it, so **a vault address commits to every parameter the vault is created with**. Whoever sends `initialize` for an address, and in whatever order, the only vault that can exist there is the one with those roots, that chain tag, that waiting period and those trusted destinations. A client that derives the address from its own recovery kit therefore needs no trust in who created the account or in what an RPC node reports about how it was created.

### 1.3 One-time keys and signatures

The signature scheme is LM-OTS, RFC 8554 section 4, with the one parameter set `LMOTS_SHA256_N32_W8` (typecode `0x00000004`): n = 32, w = 8, p = 34, signature `u32(typecode) || C (32) || y[0..33] (34 x 32)`, 1,124 bytes. Algorithm 1 (public key) and Algorithm 4b (candidate public key) are used as written; Algorithm 3 (signing) is used as written except for how the randomizer `C` is chosen (below). `docs/CRYPTOGRAPHY.md` states how this use relates to the RFC and what that leaves open.

An LM-OTS key is named by an identifier `I` (16 bytes) and a number `q` (u32). LM-OTS is used here outside an LMS tree, so `q` is always zero, as section 4 of the RFC requires, and `I` is different for every key:

```
I(role, e, i) = first 16 bytes of SHA-256( "BUNKER3_LMOTS_ID" (16) || program_id (32) || chain_tag (32) || salt (32) || role (1) || e (8, LE) || i (8, LE) )

operational key K[e][i]:   I = I(0x01, e, i),   q = 0
recovery key    R[e]:      I = I(0x02, e, 0),   q = 0
```

`role` is the role byte of the message the key signs (§3). **`root(x)`**, wherever this document says a vault stores a root, is the LM-OTS public key `K` of Algorithm 1 for the key's chain starts under its `I`:

```
op_root  = root(K[epoch][op_index])        rec_root = root(R[epoch])
```

A consequence: a root is only usable in the position it was computed for. The next operational root named by an announcement is the key for index `i + 1` of the same epoch; the roots named by a recovery packet are the recovery key of epoch `e + 1` and the operational key at index 0 of epoch `e + 1`.

**Randomizer.** With `seed` the last 32 bytes of the one-time key, candidate randomizers are `C[n] = HKDF-SHA256(IKM = seed, empty salt, info = "BUNKER-LMOTS-C" (14) || n (4, LE), 32 bytes)` for n = 0, 1, 2, .... The signer uses the first whose signature verifies within the step limit below. Signing the same message with the same key therefore always yields the same bytes.

**Step limit.** Verifying takes `sum(255 - a[i])` chain steps over the 34 digits `a` of `Q || Cksm(Q)`, which is always `255 * (h + 2)` for `h` the high byte of the checksum. The program refuses any signature that would take more than **4,080** steps (`h > 14`), before walking any chain. About 28.3% of digests are within the limit. A signature within it is an ordinary RFC 8554 signature.

## 2. Accounts

### 2.1 Vault — 447 bytes, PDA `["bunker3", vault_id]`

| Offset | Bytes | Field |
|---|---:|---|
| 0 | 8 | Magic `BUNKER03` |
| 8 | 32 | `vault_id`, immutable; the hash in §1.2 |
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
| 287 | 128 | `trusted`: four 32-byte wallet addresses, immutable. Unused slots are zero and come last; no wallet appears twice |
| 415 | 32 | `salt`, immutable; the salt of §1.1, kept so the program can name the vault's signers (§1.3) |

When `pending` is 0, bytes 157..286 must be zero. The vault is never closed. At most one pending record exists.

### 2.2 Proof — 1,198 bytes, PDA `["proof", payer, digest]`

| Offset | Bytes | Field |
|---|---:|---|
| 0 | 8 | Magic `BKPROOF3` |
| 8 | 32 | Fee payer that created it |
| 40 | 32 | SHA-256 of the signed message |
| 72 | 2 | Bytes written so far, little endian |
| 74 | 1,124 | Signature |

Written in append-only chunks of at most 600 bytes each; the reference client uses two. Re-sending bytes identical to those already stored succeeds; different bytes fail. Only the fee payer that created it can close it and reclaim its rent. Closing zeroes the account, shrinks it to nothing and returns it to the system program, so the same address can be staged again. A proof account carries a signature; it never carries authority, and closing it revokes nothing. Any fee payer may pass any complete proof account to `announce` or `recover`: what is checked is the signature in it.

### 2.3 Spent marker — 8 bytes, PDA `["spent-v3", vault_address, root]`

Magic `BKSPENT3`, never closable. **A marker belongs to one vault.** Within that vault there is one namespace for both roles: a root that has been an operational root can never become a recovery root and the reverse. Nothing done in any other vault can create, occupy or depend on a vault's markers; two vaults may hold the same root without affecting each other. **A marker is only ever created for a root that has signed**: the operational root displaced by an accepted announcement, and the recovery root that signed an accepted packet. (Earlier drafts also marked the operational root displaced by a recovery, which had not signed. Since the operational signer chooses that root freely, that let it decide what would be marked. See `docs/INTERNAL-REVIEW.md`, findings P-1, P-8 and P-11.)

## 3. Signed messages

Both messages are `domain || program_id (32) || vault_address (32) || payload`. The verifier recomputes the message from instruction data and account keys; nothing is trusted from the proof account except the signature bytes and the digest.

### 3.1 Announcement — domain `BUNKER3_ANNOUNCE` (16 bytes), payload 196 bytes

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
| 155 | 8 | `announce_by`, i64 Unix seconds, > 0, at most 86,400 after the time it lands |
| 163 | 32 | `next_op_root` = `root(K[epoch][op_index + 1])`, nonzero |
| 195 | 1 | `decimals`: the decimal places of the token as the signer was shown them; zero for SOL |

Signed by `K[epoch][op_index]`. Total message 276 bytes.

`decimals` is signed so that a wrong belief about a token fails instead of moving a different amount than the signer was shown: the amount is in the token's smallest unit, and a network connection that misreported the decimal places could otherwise make "1.0" mean a thousand times more.

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

"Signer" below is a signature the instruction itself requires. Every transaction also has a fee payer; where none is listed, any account may pay.

| Op | Name | Signer | Accounts, in order (w = writable) | Summary |
|---:|---|---|---|---|
| 0 | `initialize` | payer | payer (w), vault (w), system program | Create the vault with both roots and a delay |
| 1 | `stage` | payer | payer (w), proof (w), system program | Append signature bytes to a proof account |
| 2 | `announce` | payer | vault (w), proof, payer (w), marker of `op_root` (w), marker of `next_op_root`, system program; for SPL also the mint | Verify an operational signature, rotate it, record a pending withdrawal; moves nothing |
| 3 | `execute` | none | vault (w), destination (w); for SPL also source token account (w), mint, token program | Carry out the pending withdrawal inside its window; permissionless |
| 4 | `expire` | none | vault (w) | Clear a pending withdrawal past its deadline; permissionless |
| 5 | `recover` | payer | vault (w), proof, payer (w), marker of `rec_root` (w), marker of `next_rec_root`, marker of `next_op_root`, system program | Verify the recovery packet, install a new epoch, clear any pending withdrawal |
| 6 | `close_proof` | payer | proof (w), payer (w) | Reclaim proof rent |

In `announce` and `recover` the payer signs only to fund the spent markers. It has no authority over the vault.

### Refusal codes

Malformed input (a wrong length, a wrong account, an unknown opcode) fails with a generic program error. A refusal that a person can act on fails with one of these custom codes, which are part of the program's interface and do not change. A failed signature check is `MissingRequiredSignature`.

| Code | Meaning |
|---:|---|
| 101 | The payload names another vault or another chain tag |
| 110 | The epoch or index is not the vault's current one |
| 111 | A withdrawal is already pending |
| 112 | The announcement landed after `announce_by` |
| 113 | `announce_by` is more than 86,400 seconds ahead |
| 114 | A next root equals a current root or already has a marker |
| 116 | The mint is not a classic SPL mint |
| 117 | The mint's decimals are not the signed ones |
| 118 | The destination is an account the instruction itself uses |
| 120 | No pending withdrawal (or one from an earlier epoch) |
| 121 | `now < opens_at` |
| 122 | `now > deadline` |
| 123 | The destination supplied is not the recorded one |
| 124 | The vault would fall below its rent reserve |
| 125 | The token accounts supplied do not fit the record |
| 130 | The record has not passed its deadline |
| 140 | The recovery packet is for another epoch |
| 150 | The proof account is incomplete or holds another message |
| 160 | The creation data is not acceptable |
| 161 | The account is not the address the creation data derives |

### 4.0 `initialize` — data: `salt (32) || chain_tag (32) || op_root (32) || rec_root (32) || delay_secs (4) || trusted (4 x 32)`

Requires `op_root ≠ rec_root`, both nonzero, delay within bounds, the trusted list in canonical form (used slots first, unused slots zero, no duplicates), and the vault account to be the address derived from `vault_id = SHA-256("BUNKER3_VAULT_ID" || data)` (§1.2). Creates the vault with that `vault_id`, `op_index = 0`, `epoch = 0`, `pending = 0`, and the salt. A prefunded address must not block creation, no wallet key gains any authority over the vault, and a second `initialize` for an existing vault fails. Because the address fixes the data, creation is safe to race: a stranger who sends the same data first has created the owner's vault, and one who sends different data has created a vault at a different address.

### 4.1 `stage` — data: `digest (32) || offset (2) || chunk (1..600)`

The proof account must be the address derived from the payer and `digest`, and the third account must be the system program on every chunk. The first chunk (offset 0) creates it and records the payer and digest. A later chunk must start exactly where the stored bytes end, or lie wholly inside them and be identical. `offset + len(chunk) ≤ 1,124`.

### 4.2 `announce` — data: the 196-byte payload

Checks. All must pass; the order below is for reading, and differs from the order in the code only in which error is returned when several fail.

1. Vault owner, length, magic; PDA re-derived from stored `vault_id` and bump.
2. Payload version and role; `vault_id`, `chain_tag`, `epoch`, `op_index` equal the stored values.
3. `pending == 0`.
4. `now ≤ announce_by ≤ now + 86,400`. A signed announcement that has not landed stops being usable within a day of when it could first have landed.
5. `amount > 0`; `kind ≤ 1`; `mint` zero iff SOL; `decimals` zero for SOL; `destination` is not the vault, proof or either marker.
5a. For SPL: exactly seven accounts, the seventh being the account at `mint`, owned by the classic token program, unpacking as a mint, with `decimals` equal to the payload's. For SOL: exactly six accounts. A classic mint can never be closed or change owner, so what is checked here still holds at execution. A Token-2022 mint, a mistyped mint and a token account named as a mint are all refused here, before any key is retired.
6. `next_op_root` nonzero, differs from `op_root` and `rec_root`, its marker in this vault absent.
7. Proof account owner, magic, full length, and digest equal to SHA-256 of the recomputed message.
8. The signature is a well-formed LM-OTS signature within the step limit whose candidate public key under `I(0x01, epoch, op_index)` and `q = 0` equals `op_root` (§1.3).

Effects, atomically: create this vault's spent marker for `op_root`, which has just signed; set `op_root = next_op_root`; `op_index += 1`; write the pending record with `opens_at = now + wait`, where `wait` is zero if the destination is trusted (below) and `delay_secs` otherwise, `deadline = opens_at + max(wait, 86,400)`, `epoch`, `digest`. **No lamports or tokens move.**

**Trusted destinations.** A SOL withdrawal is trusted if `destination` equals one of the vault's non-zero `trusted` wallets. A token withdrawal is trusted if `destination` equals the associated token account of one of those wallets for `mint`: the address derived from `[wallet, token program id, mint]` under the associated token account program. Any other token account, including another one the same wallet owns, is not trusted, because only the associated account's address is one that nobody else could have chosen. The trusted list only ever shortens a wait; a vault with `delay_secs = 0` behaves the same with or without one.
 The destination's present state is not validated here; it is validated at execution.

### 4.3 `execute` — no data

Requires `pending == 1`, pending `epoch == epoch`, `opens_at ≤ now ≤ deadline`, and the supplied destination (and for SPL the mint) equal to the record. The record names no source: for SPL any token account owned by the vault with the recorded mint may be supplied, and the reference client always supplies the vault's associated token account. For SOL: debits the vault, keeping its rent-exempt reserve, and credits the destination. A SOL transfer that would leave the destination below its own rent-exempt minimum is rejected by the runtime; the record stays and can execute once the destination is funded, or expire. Clients check this before signing. For classic SPL: requires the token program, the recorded mint, a source account owned by the vault with that mint and with no delegate and no close authority, and a destination with that mint, then calls `transfer_checked` signed by the vault PDA. On success zeroes the pending record. On failure nothing changes and it may be retried until `deadline`. No hash signature is involved.

### 4.4 `expire` — no data

Requires `pending == 1` and `now > deadline`. Zeroes the pending record. Moves nothing and leaves the authority as it is.

### 4.5 `recover` — data: the 138-byte payload

Checks: vault as above; payload version and role; `vault_id`, `chain_tag` and `epoch` equal the stored values; `next_rec_root` and `next_op_root` nonzero, distinct from each other and from the current `rec_root`, both of their markers in this vault absent; proof digest; the signature is a well-formed LM-OTS signature within the step limit whose candidate public key under `I(0x02, epoch, 0)` and `q = 0` equals `rec_root` (§1.3).

**`recover` neither reads nor marks the operational root.** The operational signer chooses each next operational root freely and can install any 32 bytes there, including a root that this packet, or a later one, names. If recovery compared the packet with that root, or marked that root spent, a stolen day key with sight of a packet could make this recovery or a future one fail for good. The displaced operational root is simply overwritten. That is safe because every announcement names its epoch: a signature made under a root in epoch `e` can never be accepted once the epoch has moved on, whether or not that root is ever installed again.

Effects, atomically: create this vault's spent marker for `rec_root`; set `rec_root = next_rec_root`, `op_root = next_op_root`, `op_index = 0`, `epoch += 1`; zero any pending record. **Never debits the vault.** There is no time condition: recovery is valid before, during and after a waiting period.

### 4.6 `close_proof` — no data

The proof account must be program-owned with the proof magic, and its recorded payer must sign. Moves its lamports to the payer, zeroes it, shrinks it to nothing and assigns it to the system program.

## 5. Transition table

State is `(epoch e, op_index i, pending P)`. Every row not listed fails with no state change.

| From | Instruction | Guard | To |
|---|---|---|---|
| `(e, i, none)` | `announce` signed by `K[e][i]` | `now ≤ announce_by ≤ now + 86,400` | `(e, i+1, P)` |
| `(e, i, P)` | `announce` | — | fails: one pending operation |
| `(e, i, P)` | `execute` | `P.epoch = e`, `opens_at ≤ now ≤ deadline`, transfer succeeds | `(e, i, none)`, assets moved once |
| `(e, i, P)` | `execute` | `now < opens_at` or `now > deadline` | fails |
| `(e, i, P)` | `expire` | `now > deadline` | `(e, i, none)` |
| `(e, i, any)` | `recover` signed by `R[e]` | — | `(e+1, 0, none)` |
| `(e, i, any)` | `recover` signed by `R[e']`, `e' ≠ e` | — | fails |

Consequences to check against the implementation:

1. **No transfer to an untrusted destination before the vault's waiting period.** The only instruction that debits the vault is `execute`, which requires `now ≥ opens_at`, and `opens_at` is the announcement time plus `delay_secs` unless the destination is one of the vault's trusted wallets (or its associated token account), in which case it is the announcement time. Both the waiting period and the trusted list are fixed when the vault is created and are part of its address. **The waiting period may be zero**, in which case every `announce` and `execute` can share one transaction and property 4 and the cancel path below give no reaction time; see [Trusted destinations and the waiting period](#trusted-destinations-and-the-waiting-period).
2. **At most one transfer per announcement.** `execute` zeroes the record in the same instruction as the transfer.
3. **No field changes between announcement and execution.** `execute` takes no data; every transfer field comes from the record.
4. **Recovery always wins over a pending withdrawal that has not executed.** It zeroes the record; a stale `execute` then fails on `pending == 0`.
5. **A root that has signed is never installed again** in that vault, in either role.
6. **An operational key cannot block recovery, now or later.** Neither the packet for epoch `e` nor the transaction that carries it depends on any operational state: announcements change `op_root` and `op_index` and can mark only roots that the operational signer itself signed under, and `recover` reads none of those. A recovery transaction built before an announcement lands is still valid after it.
7. **Expiry never strands the vault.** An announcement that is signed but not landed by `announce_by`, an execution that never succeeds, and a lost epoch seed all leave `recover` available while `M` exists.
8. **Vaults are independent.** No instruction on one vault reads or writes any account that another vault's instructions depend on. In particular no party without a vault's keys can make its `announce` or `recover` fail.
9. **A vault is what its address says.** The address is derived from a hash of the creation data, so the roots, chain tag and waiting period at an address are the ones its owner derived, whoever created the account.

Races that chain ordering decides, and that the product must describe honestly: `execute` against `recover` after `opens_at` (if `execute` lands first, the transfer stands and recovery protects only the remainder); two devices submitting the same recovery packet (one succeeds, the other fails on `epoch`).

## Trusted destinations and the waiting period

A vault is created with up to four trusted wallets and a waiting period of 0 to 7 days. A withdrawal to a trusted wallet opens at once; a withdrawal to anything else waits. The reference tool starts on 24 hours, lets the owner choose another period or none, and in every case requires the owner to accept a sentence stating exactly what was chosen.

This is the design's answer to a stolen day key. An internal design review concluded that with no waiting period a vault protects against a malicious signature in the wallet and against a leaked seed phrase, and not against whoever obtains the day key and its password, by malware, by a copy of the site, or by a compromise of the site itself. A waiting period on every withdrawal closes that, at a cost the owner had judged unacceptable as a default. Trusted destinations keep the owner's own withdrawals immediate while making a thief's wait:

- **With a waiting period and trusted wallets.** The holder of a stolen day key can do two things: send to the owner's own trusted wallets, at once, which returns the assets to the owner; or announce a withdrawal elsewhere, which waits, is visible on-chain, and is cancelled by recovery. The thief gains only if a trusted wallet is one the thief also controls, so those should be wallets that a compromise of the owner's everyday device does not reach.
- **With a waiting period and no trusted wallets.** Every withdrawal waits.
- **With no waiting period.** Whoever holds a valid day key and its password can announce and execute to any address in a single transaction. Recovery can still replace the keys, but only before a theft, not during one. A wallet key alone still cannot withdraw.

In every configuration: the announcement must be signed by the current one-time operational key; the signed fields fix the amount, asset and destination; the key rotates on use; and a lost or exposed day key, an expired announcement and an interrupted signing are all recoverable with the archival kit.

The trusted list cannot be changed. Changing it would need a second kind of message signed by the recovery key, which today signs exactly one fixed message per epoch (§3.2), and that property is worth more than the convenience. An owner who wants a different list builds a new vault and moves to it; from a vault with a waiting period that means one waiting withdrawal per asset unless the new vault's owner-controlled address was listed as trusted.

## 6. `chain_tag`

A Solana program cannot read the genesis hash. `chain_tag` is 32 bytes chosen at initialization and immutable; the reference client sets it to the cluster's genesis hash. The offline tool has no network access and so cannot check the tag itself: it takes the tag and the program id from a network card downloaded from the site, shows both, and requires the user to confirm they match what the site displays before it derives anything. The tag separates deliberately distinct deployments in derivation, in the vault address and in signed bytes. It does **not** prevent replay on a fork or a cloned ledger that copies identical program and vault state. The program cannot tell whether a tag is the right one for its cluster; a vault created with a different tag is simply a different vault at a different address.

## 7. Off-chain rules that the chain cannot enforce

These are trust assumptions, not program guarantees.

0. **A recovery packet is not secret, and nothing may rely on it being so.** It is uploaded to a website and broadcast. The protocol must hold against someone who has read it before it lands.
1. The recovery tool exposes no general signing interface. Its only output for epoch `e` is the packet in §3.2, built from derived values. The claim that re-deriving and re-emitting the identical packet is safe rests on the message being byte-identical; it must be reviewed against the LM-OTS construction and the derived randomizer of §1.3.
2. `M` never enters the everyday web application. The operational signer receives `S[e]` only.
3. One active operational signer per epoch, with a durable record written before signing. Two devices holding `S[e]` can still sign two different announcements at the same `(e, i)`; the chain accepts at most one, and the correct response to any doubt is `recover`, never a second signature.
4. A restore without a trustworthy operational record must not sign with `K[e][i]`. It recovers to `e + 1` first.
5. The operational record only moves forward. The reference client keeps every `(e, i)` it has reserved. If the chain appears to be at a tuple it has already signed for, it re-sends those bytes; if it appears to be behind anything it has signed and it no longer holds the bytes, it refuses. It signs only when the chain's `op_root` equals the root its seed derives for that tuple, so a false view of the vault cannot draw a signature for a key the view did not come from.
6. The recovery kit and the day key have different passwords. The day key's is typed into a website; the kit's never is.
7. What is shown for review is what is signed. The reference client builds the withdrawal once, displays it, and signs that object.

## 8. Evidence required before implementation is called complete

- Independent derivation vectors for `R`, `S`, `K` and both message encodings, generated by Rust and checked by TypeScript and the reverse.
- For every row of §5 and every failing combination: a local-validator test, including boundary seconds at `announce_by`, `opens_at` and `deadline`.
- Cross-role and cross-vault substitution: an announcement proof submitted to `recover` and the reverse; a packet for another vault, program, `chain_tag` or epoch.
- Recovery racing each state: before announcement, during the wait, at `opens_at`, after `deadline`, and in the same slot as `execute`.
- Root reuse: `next_op_root` or `next_rec_root` equal to any current or spent root, and to each other.
- Isolation: a second vault holding the first vault's current, recovery or next root, recovered or announced in any order, leaves the first unaffected; `initialize` for an address with any parameter changed fails; `initialize` raced with identical parameters yields the intended vault.
- Failed `execute` (frozen destination, closed token account, insufficient rent) leaves the record intact and retryable; `recover` then clears it.
- Counter limits at `u64::MAX` for `epoch` and `op_index`, and an operation index beyond 32 bits; `opens_at` and `deadline` overflow.
- Compute-unit measurements for `announce` and `recover` (one verification each, one and two marker creations).

## Implementation status

`programs/bunker3` implements sections 2 to 5: `src/state.rs` holds the layouts and every transition as pure functions; `src/lib.rs` holds account validation, signature verification, spent markers and transfers. `crates/bunker-lmots` is the LM-OTS verifier it calls (section 1.3). `sdk/v3` is the TypeScript client: `derive.ts` (section 1.1), `onetime.ts` over `sdk/lmots.ts` (section 1.3), `core.ts` (addresses, the vault identity and the recovery packet's bytes, with no Solana library), `master.ts` (everything computed from the archival master, including the fixed recovery packet), `protocol.ts` (encodings, vault parsing and instruction builders) and `authority.ts` (announcement signing from an epoch seed). `tools/cli` is a command-line client over the same code. `sdk/v3/kit.ts` defines the two key files (archival kit and day key), `sdk/v3/journal.ts` the operational signing journal, and `sdk/v3/chain.ts` the vault and clock reads. A draft web interface exists: the rebuilt `/vault` (open with a day key, deposit, announce, countdown, release, clear, seal) and `/recovery`, which only submits public files. **The archival master is handled only by the offline recovery tool** (`tools/recovery`, built by `scripts/build-recovery-tool.mjs` into one self-contained HTML file). Its own Content Security Policy sets `default-src 'none'` and `connect-src 'none'` and pins the inline script by hash; the build publishes the file's SHA-256. The tool and the site exchange three public file types defined in `sdk/v3/requests.ts`: a network card (site to tool), a creation request (the salt, two commitments and the waiting period; the site recomputes the vault address from them and refuses a request that does not match) and a recovery packet (payload and signature). The site verifies a packet's signature against the on-chain recovery commitment before submitting it. Remaining gaps for this separation: the tool is served from the same domain as the site, so a compromised site could serve a different file, and only the published hash and reproducible build let a user detect that; the day key is still opened in the site's origin by design; and a browser on an online device is not an air gap. The interface handles SOL and classic SPL tokens; for a token the recipient's associated token account is created when the withdrawal is announced, so it exists when a waiting withdrawal is released. A day key can optionally be saved on a device under a passkey (`sdk/v3/passkey.ts`): it is encrypted with a key derived from the authenticator's WebAuthn PRF output and only the ciphertext is stored in the browser. That protects a day key at rest on one device; it is not a backup and does not involve the archival master.

| Evidence | Where | Count |
|---|---|---:|
| Transition table, encodings, boundaries and overflow against the pure state logic | `programs/bunker3/tests/state.rs` (`cargo test -p bunker3`) | 25 |
| The compiled SBF binary in an in-process Solana VM with a controlled clock | `programs/bunker3-svm-tests/tests/program.rs` (standalone crate; see `docs/TESTING.md`) | 34 |
| Isolation, on the same VM: a stolen day key paying trusted wallets at once and a stranger only after a cancellable wait, a malformed trusted list, a day key planting the roots of this recovery packet or the next one, recovery after operational progress, one account in two slots of `announce` and `recover`, shared roots across vaults, a root copied under another salt, the address commitment, racing `initialize`, markers from another vault, re-staging a closed proof, prefunded addresses | `programs/bunker3-svm-tests/tests/isolation.rs` | 16 |
| TypeScript client: RFC 5869 vector, context layout, role and epoch separation, encodings, the vault identity, instruction shapes, and byte-for-byte reproduction of `fixtures/bunker-v3.json` | `tests/protocol-v3.test.ts` (`npm test`) | 17 |
| The client's vectors against an independent Rust derivation (RustCrypto HKDF) of every key, public key and signature, byte for byte, including one whose first candidate randomizer is over the step limit; the program's verifier; and the compiled program (create, announce, recover, announce in the next epoch) | `programs/bunker3-svm-tests/tests/client_vectors.rs` | 3 |
| LM-OTS against RFC 8554 Appendix F, in Rust and in TypeScript. Test Case 1: both signatures verify to the candidate keys that lead, through the printed Merkle paths, to the printed LMS public keys. Test Case 2: from the printed private key, signing reproduces the printed signature and the public key leads to the printed LMS public key | `programs/bunker3-svm-tests/tests/rfc8554.rs`, `tests/lmots.test.ts`, `cargo test -p bunker-lmots` | 4, 9, 7 |

The second suite covers: nothing leaving before `opens_at` and exactly once after; the inclusive `announce_by`, `opens_at` and `deadline` seconds; permissionless execution; expiry leaving the authority usable; recovery when idle and while a withdrawal is pending; the signing recovery root retired and the displaced operational root left unmarked; a recovery packet bound to its epoch; cross-role proof substitution; altered payload bytes; retired roots refused as any next root; the rent reserve; a forged vault account; proof staging and close; a correct signature made under another index, role, generation, salt, chain or program; malformed signatures and other typecodes; a correct signature over the step limit, and the cost at the limit; an operation index beyond 32 bits; the heaviest client transaction inside the requested compute limit; a classic SPL withdrawal including a frozen destination that later thaws; and eleven wrong sets of token accounts for `execute` (a source owned by someone else, of another mint, with a delegate, with a close authority, or not owned by the token program; source equal to destination; another mint; another program in place of the token program; an unrecorded destination; missing and extra accounts), each leaving the record and balances untouched.

Each of the following checks was removed in turn and the suite confirmed to fail (an earlier entry, retiring the displaced operational root, is gone because that rule was itself removed): the waiting period, signature verification, clearing the record on recovery, the vault PDA check, clearing the record after execution, destination binding, the next-root marker check, computing the vault identity from the creation data, scoping markers to the vault, returning a closed proof to the system program, and the bound on `announce_by`. For the signature verifier, nineteen further changes were each made and each caught: the step limit, the typecode check, either checksum digit, the chain index, step number or `q` left out of a chain hash, the randomizer or the last message part left out of the message hash, the comparison with the stored root, each of the six inputs of the identifier, the recovery identifier taking the operation index, and `q` set to one.

Measured on that VM, for a signature at the step limit of §1.3, which is the most signature verification can cost: `announce` 568,041 compute units and `recover` 574,652; called through another program, 571,483 and 579,177. The reference client requests 800,000, and every VM test runs under that limit; the heaviest transaction the client builds (a token withdrawal to the last of four trusted wallets with a signature at the limit, creating the recipient's token account, announcing, releasing and closing the proof) used 603,120. A signature over the limit is refused for under 40,000 units. (The construction used before LM-OTS had no limit and could need over a million.)

| Account handling, by differential fuzzing on the same VM: for each instruction about 250 damaged copies (accounts swapped for each other, for another vault's, for look-alikes owned by other programs or for unrelated addresses; accounts dropped, repeated or added; flags flipped; a stranger's real signature in the payer's place; data flipped, cut or extended). Each must fail or leave every account exactly as the honest instruction does, and never pay the stranger. Run at 32 times that length before merging. Removing the destination check, the marker address check or the proof-owner check makes it fail | `program.rs`: `a_damaged_instruction_fails_or_does_exactly_what_the_honest_one_does` | 1 |
| Every instruction called through another program (a test-only forwarder, `programs/bunker3-cpi-probe`), including a token release two calls deep; a clock that goes backwards | `program.rs` | 3 |
| Public file formats (rejecting secrets, mismatched vaults, a packet whose stated epoch differs from its signed payload, and signatures from another master) and the tool page's policy | `tests/requests-v3.test.ts` | 5 |
| Randomized: 20,000 sequences of up to 40 interleaved announce, execute, expire, recover and time steps (a quarter corrupted) against invariants, with an operational signer that chooses its next roots adversarially (the current roots, marked roots, and the roots of this and the next recovery packet) and a model of the spent markers; the undamaged recovery packet must always land. And 300,000 arbitrary inputs to every decoder. Fixed seed, no external crates | `programs/bunker3/tests/model.rs` | 2 |
| Exhaustive: every sequence of announce (naming any root the signer could know, to a trusted or untrusted destination), execute, expire, recover and waiting, up to twelve actions deep, over a small alphabet of roots and with a model of the spent markers. In every state: the current epoch's recovery packet lands and no other does; no live root is marked; nothing leaves before its wait | `programs/bunker3/tests/exhaustive.rs` | 1 |
| Repeated cycles on a local validator with the app's client: create, withdraw (instant and waiting), replay, recovery, continue; every expected rejection asserted | `tests/chain-v3.ts` (`npm run test:chain`) | script |
| Signing journal and key files: one signature per key, racing tabs, an orphaned reservation, chain advance, a chain view that goes forward and then back, a key the day key does not derive, an unreadable journal, file confusion and tampering | `tests/journal-v3.test.ts` | 17 |
| Browser, against a local validator running this program: build, deposit, announce (state and balances asserted on-chain), countdown, cancel by recovery, dead old day key, announce with the new key, seal | `tests/browser/custody3.spec.ts` | 1 × desktop and mobile |

In the browser suite the offline tool is opened as a local `file://` page, every file passes between it and the site through the filesystem, and the suite asserts the tool page issued no network request. The browser suite has two cases: a vault with no waiting period, where a withdrawal arrives on the third approval, and a vault that opted into 24 hours. It cannot let 24 hours pass, so releasing after a wait is exercised only by the VM suite.

The client and the Rust check share one author and one reading of this document; agreement between them shows consistency, not correctness of the design.

Known gaps: the fuzzing is from a fixed seed and is not coverage-guided; the cross-program tests use one forwarding program, not a real integration; no implementation by a second author (the Python check in `scripts/independent-check.py` is a third implementation from this document, by the same project); SPL coverage is two VM tests and one browser scenario; passkey unlock is tested with a simulated authenticator only, not on real phones. None of this is an audit.

## Open questions

An internal design review (three reviewers; recorded in `docs/INTERNAL-REVIEW.md`) ruled on each of these. Where it led to a change, the entry says *Decided*. The others were ruled "keep" and stay listed because an outside reviewer should still be free to disagree.

Each is a decision this draft made provisionally and wants challenged.

0. **The signature scheme.** *Changed after the internal design review:* LM-OTS as specified in RFC 8554 replaced a plain iterated-SHA-256 Winternitz construction. It is used on its own in a chain, as section 4 of the RFC permits (`q = 0`), not inside the LMS tree the RFC's cited analyses cover; the identifier is derived from the vault rather than random; and the randomizer is derived and selected (§1.3; `docs/CRYPTOGRAPHY.md`). Each of those three choices wants an outside cryptographer's judgement.
1. **Deterministic recovery signature.** Is one fixed message per recovery key, re-emitted byte-identically, acceptable for LM-OTS with the derived randomizer of §1.3, including after a crash between derivation and submission? If not, the recovery role needs a different, separately reviewed scheme.
2. **`epoch` doubles as the recovery index.** It removes a counter and a class of mismatch. Is there a case that needs them to diverge?
3. **`announce_by` at all.** Announcement rotates the operational root, so an unlanded announcement leaves the on-chain root unchanged and the off-chain key consumed; `recover` resolves that. Dropping the field would remove a time check but let an old signed announcement land at any later time.
4. **Unix seconds rather than slots.** `Clock::unix_timestamp` is validator-reported and can drift. A waiting period of an hour or more is large relative to plausible drift; the boundary tests in §8 should state the assumed bound.
5. **Immutable `delay_secs`.** Changing the delay is a policy operation with its own delay and is deferred. Is a fixed per-vault delay acceptable for a first release?
6. **Execution window.** *Decided in the internal design review:* the window is as long as the wait that applied to that withdrawal (the vault's waiting period, or nothing for a trusted destination), with a one-day floor, as a program rule rather than a signed field. Execution is permissionless, so a day is enough for an honest release, and a record that cannot execute blocks a vault with no waiting period for one day rather than seven.
7. **Permissionless `execute`.** It means the fee wallet is not needed at execution and alerts cannot be bypassed by withholding; it also means anyone can complete an announced transfer the moment it opens. The alternative binds execution to a signer and reintroduces a liveness dependency.
8. **One spent-marker namespace for both roles within a vault, holding only roots that have signed.** An operational root displaced by recovery is not marked. The argument that this is safe is that announcements are bound to their epoch; it deserves an independent check.
9. **No migration path between program deployments.** A changed layout means a new program id and new vaults. *Decided, then changed:* the plan was an immutable deployment. The beta program is upgradeable instead (docs/DEPLOYMENT.md), so a fix can be made in place while the account layout is unchanged; a changed layout still means a new program that users move to by withdrawing.
10. **`chain_tag` is client-asserted.** It is now part of the vault address, so a wrong tag cannot be attached to an owner's address by someone else, but the owner's own tool still takes it from a file. Is a stronger check worth its cost?
11. **A zero waiting period is permitted.** *Changed after the internal design review:* the reference tool now starts on a 24-hour wait for untrusted destinations, with up to four trusted wallets that do not wait, and zero remains available behind an explicit statement. Should a reviewed release allow zero at all?
12. **Token-2022 is not supported, and nothing stops someone sending such a token to a vault.** It would be held by an account the program cannot move. Should a reviewed release add support, or a recovery path for tokens it does not handle?
13. **The recorded `digest` is not read by the program.** It identifies the announcement for clients and alerts. Keep it, or drop 32 bytes from the layout?
14. **Token decimals shown before signing came from the RPC.** *Decided:* the decimal places are part of the signed announcement and the program checks them against the mint (§3.1, §4.2 5a). A network connection that misreports them now causes a refused announcement, not a different amount. Balances shown are still whatever the connection reports.
15. **No way to withdraw a pending record except execution, expiry or recovery.** A record that cannot execute (the recipient closed or froze the token account, the destination became a program, a Token-2022 mint was named) held the single pending slot for the waiting period plus seven days. **Decided:** the mint is checked at announcement (§4.2 5a) and the execution window is the waiting period again with a one-day floor (§4.2), so the remaining cases (a recipient who closes or freezes their token account) block the vault for at most the waiting period plus that window. A cancel signed by the operational key was considered and rejected for this version: it needs a second operational message type and consumes a key, and it would invite owners to "cancel" a thief's withdrawal when the only correct response is recovery.
16. **`announce` and `recover` cost up to about 575,000 compute units.** *Changed:* an earlier draft could need 1.1M of the 1.4M a transaction may use. The step limit of §1.3 now caps verification, at the price of the signer discarding about three randomizers in four. Is selecting the randomizer by a public property of the digest acceptable, and is 4,080 the right limit?
17. **Trusted destinations are immutable and identified by wallet.** Is four the right number? Should a vault be able to add one after a waiting period of its own, at the price of a second recovery-signed message type? Is matching only the associated token account the right rule for tokens?
