# Internal review, October 2026

**This is not an audit.** It is the project's own adversarial review of the draft at commit `3d19810`, carried out before asking anyone outside to look, so that outside reviewers do not spend their time on what the project could have found itself. Four reviewers worked independently, one each on the on-chain program, the cryptographic design, the client and offline tool, and the website and alert service. Each was asked to break it, and to demonstrate what they claimed with a working test. They share an author's blind spots with the code they reviewed. No independent party has checked the findings or the fixes.

Severity is the project's own judgement. "Test" names the regression test that reproduces the original attack and now requires it to fail.

## Program and protocol

| ID | Severity | Finding | Resolution | Test |
|---|---|---|---|---|
| P-1 | Critical | **Spent markers were shared by every vault.** A marker's address came from the root alone, `initialize` accepted any root, and `recover` retires the displaced operational root without a signature under it. Anyone could create a vault holding a victim's public `op_root` or `rec_root`, recover it with their own key, and permanently block the victim's `announce` and `recover`. A day-key thief could block cancel-by-recovery during the waiting period and collect when it ended. | Markers are derived from the vault address and the root. `initialize` takes no marker accounts. | `isolation.rs`: `retiring_a_root_in_one_vault_does_not_retire_it_in_another`, `two_vaults_may_hold_the_same_root`, `a_marker_from_another_vault_is_refused` |
| P-2 | Critical | **A vault's address did not commit to its keys.** The address came from a caller-chosen identifier, and `initialize` was first come, first served. Whoever sent it first chose the roots, chain tag and waiting period at that address: for example the victim's operational root with the attacker's recovery root, drained after the victim deposits. The client checked none of them. | The identifier is now SHA-256 of the creation data, computed by the program; key derivation is bound to a random salt instead. The client derives the address from the recovery kit, validates a creation request against its address, and reads a new vault back before reporting it built. | `isolation.rs`: `the_address_commits_to_every_creation_parameter`; `protocol-v3.test.ts` "vault identity"; `requests-v3.test.ts` |
| P-3 | Low | `close_proof` zeroed a proof account but left it program-owned at full size. Refunded later in the same transaction it survived as an account that could be neither staged nor closed. | Closing shrinks the account to nothing and assigns it to the system program. | `isolation.rs`: `a_closed_proof_can_be_staged_again` |
| P-4 | Low | `announce_by` had no upper bound, so a signed announcement could stay usable for as long as the vault stayed at that index. | It may be at most one day ahead of the clock when it lands. The client also refuses a deadline far ahead of the device clock. | `state.rs`: `announce_guards`; `journal-v3.test.ts` |
| P-5 | Informational | A SOL withdrawal that would leave a new destination below its rent-exempt minimum cannot execute and occupies the pending slot until funded or expired. | By design; documented in PROTOCOL.md §4.3. The client checks before signing. | `isolation.rs`: `a_sol_withdrawal_below_the_destination_rent_minimum_waits_for_funding` |
| P-6 | Informational | The specification and the code disagreed in places: no sections for `stage` and `close_proof`, no account lists, "two chunks" where any number is accepted, a "source" in `execute` that the record does not hold, signer columns for permissionless instructions. | PROTOCOL.md corrected. | — |
| P-7 | Open | Token-2022 tokens sent to a vault cannot be moved by the program. The recorded `digest` is unused on-chain. | Listed as open questions 12 and 13. | — |

## Cryptographic design

| ID | Severity | Finding | Resolution | Test |
|---|---|---|---|---|
| C-1 | Informational | The vendored Winternitz verifier, the TypeScript port, the HKDF derivation and both encodings were found consistent with each other and with the specification. The recovery packet is a function of the master, the descriptor and the epoch only. | None needed. | Existing vectors |
| C-2 | Medium (documentation) | CRYPTOGRAPHY.md said two signatures under one key "can permit forgery". It is practical: a worked pair needed about 2^23 hash evaluations, and the estimated median for random pairs is near 2^37. | Stated plainly, with the consequence: a key that may have signed twice is compromised; recover. | — |
| C-3 | Medium | PROTOCOL.md said the offline tool pins the cluster. It does not and cannot; it trusted the network card silently. | The tool displays the network, genesis and program from the card and requires confirmation; the specification now says what it does. | `custody3.spec.ts` |
| C-4 | Low | The tool did not check its own output. | A recovery packet is verified against the derived recovery root before it is saved. | — |
| C-5 | Low | Password policy was length only. | A floor on variety is added and its limits are stated. A memory-hard KDF is not adopted in this draft. | `journal-v3.test.ts` |
| C-6 | Low | Passkey unlock was described as tied to one device; passkeys can sync. | Wording corrected in code, interface and documents. | — |

## Client and offline tool

| ID | Severity | Finding | Resolution | Test |
|---|---|---|---|---|
| K-1 | High | **The signing journal was not monotonic.** It kept one entry. A connection that showed the vault at index 5, then 6, then 5 again obtained two different signatures under the key for index 5. | The journal keeps every tuple it has reserved and never forgets one. A view that goes back gets the bytes already signed, or a refusal. It signs only when the reported root is the one the day key derives for that tuple. | `journal-v3.test.ts`: "never signs twice when the chain view goes forward and then back" and three more |
| K-2 | High | **What was reviewed was not necessarily what was signed.** The asset and its decimals were looked up again at signing time from form state that could change after review. | The withdrawal is built once at review; the screen shows that object and the signature covers it. Inputs are locked while a step is running. | `custody3.spec.ts` (all cases sign through this path) |
| K-3 | High | **The day key was encrypted with the recovery kit's password**, and the day key's password is typed into the website. A compromised site would learn the password that opens the kit. | Separate passwords, both required; the tool refuses equal ones. | `custody3.spec.ts` |
| K-4 | Medium | Any token account owned by the vault was listed and could be chosen as a source, including ones created by other people. | Only the vault's associated token account is used or shown. | `custody3.spec.ts` (tokens) |
| K-5 | Medium | Passkey unlock skipped the cross-device statement, on the premise that a key saved on a device has only been used there. The same key exists as a file. One storage slot per program meant saving a second vault's passkey destroyed the first. | The statement is required for both ways of opening. One record per vault. Removing a record also tells the browser the credential is gone where that is supported. | `custody3.spec.ts` (passkey) |
| K-6 | Medium | The offline tool would run when opened from the website, where it could be replaced or observed. | It runs only from `file:`. The site serves it as a sandboxed download. Its policy also blocks WebRTC. | `app.spec.ts` |
| K-7 | Low | The key being retired was named from page state that could be stale. Deposits were offered with a replaced day key loaded. An unreadable journal threw during rendering. A token's pending amount was labelled "lamports". An error pattern matched transaction signatures containing "503". | Each corrected. | — |
| K-10 | Low | Bunker Mode re-read the wallet when it ran and moved every token it then found, including ones that were not on the list the user had been shown. | It moves only what was listed. | `custody3.spec.ts` (bunker mode) |
| K-11 | Open | If a signature is uploaded and the announcement then never lands, the upload account's deposit (under 0.01 SOL) stays there until its payer closes it. The interface offers no button for that. | Not changed in this draft. | — |
| K-8 | Open | The offline tool bundles the full Solana web3 library for address derivation, about a third of a megabyte of code that a reviewer must trust or read. | Not changed in this draft. Replacing it with a small audited helper is worth doing before a reviewed release. | — |
| K-9 | Open | A recovery packet for a future key generation can be produced by typing a larger number. Publishing one early lets anyone advance the vault to the next generation once it reaches that number. It installs only the owner's own next keys. | The tool's wording directs the user to the number on their Bunker page. Not otherwise restricted. | — |

## Website and alert service

| ID | Severity | Finding | Resolution | Test |
|---|---|---|---|---|
| W-1 | High | **Alerts could be suppressed.** The watcher read the newest ten transactions per pass; older ones were never seen again. Ten dust transfers after an announcement hid it. | The watcher no longer reads transactions. It compares each vault account with its previous snapshot. | `alerts-chain.ts` (flood); `alerts.test.ts` |
| W-2 | High | **Alerts could be evaded and faked.** Only top-level instructions were classified, so a call made through another program was invisible; and an instruction acting on a different vault, in a transaction that merely touched the watched one, was reported against the watched one. | As W-1 for alerts. The activity log, which still reads transactions, now requires the instruction to act on this vault and reads inner instructions. | `alerts-chain.ts` (stranger's recovery); `history-v3.test.ts` |
| W-3 | Medium | 25 vaults per pass against a 5,000-vault cap meant a vault could go more than three hours between checks; passes could overlap; failures were swallowed. | Up to 1,000 vaults per pass in batched reads, a lock per pass, logged failures. | `alerts.test.ts` |
| W-4 | Medium | Subscription changes were several unprotected writes; a crash or a race could leak a slot or orphan a subscriber. | The webhook is registered with one connection at a time; writes are ordered so a partial change is removable; the watcher drops a vault with no subscriber. Not atomic. | `alerts.test.ts` |
| W-5 | High | **The public source archive was built from a deny-list over the checkout.** A wallet keypair, a token-bearing `.npmrc`, or a recovery kit saved under an unexpected name would have been published. The ignore files named only an older file pattern. | Built from an allow-list; key-like files inside it stop the build; a test requires the result to equal what Git tracks. | `source-bundle.test.ts` |
| W-6 | Medium | Not-found pages under paths the proxy skips had no Content Security Policy. | A fixed policy that runs and loads nothing is applied to those paths. | `app.spec.ts` |
| W-7 | Medium | `/api/rpc` had no rate limit and allowed a small request to pull a 3 MB answer. `/api/verify` made upstream calls on every request. | List reads bounded, answer size halved, a per-address limit per server instance, and a one-minute memory for `/api/verify`. A platform firewall rule is still needed. | `rpc.test.ts` |
| W-8 | Low | A pull request from a fork could upload a CI artifact named like the official recovery tool. The Rust toolchain floated. A malformed program id was accepted as configuration. | Upload restricted to `main`; toolchain pinned; program id validated. CI now also builds the program and runs the VM suites. | `release.test.ts` |
| W-9 | Housekeeping | Compiler output of the VM test crate had been committed. | Removed from the tree. It remains in history. | — |

## What was tried and held

Enabling mainnet writes through environment or forged configuration; reaching a non-allowlisted RPC method through the proxy; script injection through `/check?a=`, the not-found page and SVG assets; substituting instructions between simulation and wallet signing; an RPC redirecting a withdrawal's destination; crafted key files and public files; secrets in published files; and, in the program, type confusion between account kinds, account aliasing, cross-role proof substitution, replay, double execution, and redirecting a token transfer.

## What this review does not establish

That the design is sound; that the Winternitz construction is correctly chosen or implemented beyond agreement between two ports; that the fixes introduce no new flaw; that any of the estimates above are right. Two critical flaws survived every earlier test because no test put two vaults in one world. The same may be true of something else.
