# Cryptographic construction and provenance

Status: experimental, unaudited. No production or post-quantum security level is asserted.

## Signature primitive

The source in `crates/winterwallet-core/src` is copied without algorithmic edits from Blueshift Winterwallet commit `672fc6789b1532ee680f24842d235e0be8737b61`, https://github.com/blueshift-gg/winterwallet (MIT; Dean Little). The manifest is adapted to this workspace. Its own README says it is not formally audited. Its claims are not adopted as independent assurance.

Bunker selects N=32, the full SHA-256 message digest. There are 32 message scalars and two checksum scalars, each 32 bytes. Chains perform SHA-256 up to 255 times; the checksum is sum(255 - digest[i]), encoded as two big-endian digits. Public chain endpoints are committed with tagged Merkle leaves SHA256(0x00 || endpoint) and nodes SHA256(0x01 || left || right), duplicating the rightmost node on odd levels. A signature is 1,088 bytes. This is the upstream Winternitz construction, NOT WOTS+, LMS, XMSS, or an asserted NIST-approved scheme.

`sdk/winternitz.ts` is a TypeScript port using pinned `@noble/hashes` SHA-256. `fixtures/winterwallet-n32.json` is generated from a PUBLIC TEST mnemonic and compared byte for byte in tests. `vendor/winterwallet-revision.json` pins every upstream algorithm file's SHA-256; tests reject drift. Bunker does not use the upstream mnemonic derivation.

### What a single signature rests on

The chain function is plain iterated SHA-256 on 32 bytes: no per-chain or per-position tweak and no public seed. Forging a signature for a different message, given one signature, needs a SHA-256 second preimage or the inversion of one chain step; the cheapest target is the high checksum chain. That is the security of SHA-256 preimages, about 2^256 classically and about 2^128 against Grover's algorithm, and it is this project's reading, not a reviewed result.

Because the hashing is untweaked, every chain value that any vault has ever exposed is a target for the same function, so a multi-target search across all of them is cheaper than a search against one by a factor of the number of targets. Only values under a root that is still current are worth finding, which keeps the practical number small, but the construction has no tight security proof of the kind WOTS+, XMSS and LMS have, and it is not a standardised parameter set. An outside cryptographer should be expected to ask why one of those was not used. The honest answer is that the verifier was adopted from prior work for its on-chain cost; whether to replace it is a question for the design review.

The checksum is sound: raising any message digit lowers the checksum, and the two checksum digits cannot both stay at or above their old values when the sum falls. With a fixed 34 leaves and tagged hashing the Merkle commitment has no ambiguity.

### One key, one message

A one-time key must sign at most one message. Signing two different messages with one key makes forgery practical, not merely possible: each signature reveals every chain at the height of its digit, so two signatures reveal each chain at the lower of the two, and any message whose digits (and checksum digits) are all at or above those heights can then be signed without the key. An internal estimate for random pairs of messages puts the median work to find such a message near 2^37 SHA-256 evaluations (recomputed independently over 6,000 random pairs: median 2^36.9, one pair in ten under 2^29, one in a hundred under 2^24, and a real forgery found for one pair in 2^17). An attacker who can influence the second message does better than the median. These are estimates by this project, not a reviewed bound. The operational conclusion does not depend on the exact figure: **a key that may have signed twice is compromised, and the response is recovery**, which retires it. Everything in the protocol and client that looks like bookkeeping exists to keep a second signature from happening, or to recover when it is in doubt.

## Key derivation

One uniformly random 32-byte archival master derives every key with HKDF-SHA256 (RFC 5869), empty HKDF salt, and a fixed 113-byte context binding chain tag, program id, a random per-vault salt and the waiting period, followed by a role byte and little-endian indices. The vault's identity is the SHA-256 of a domain string, that salt, the chain tag, both genesis roots and the waiting period (PROTOCOL.md §1.2); the program computes it and derives the vault address from it, so the address commits to the keys. The exact inputs are in [PROTOCOL.md](PROTOCOL.md) §1.1 and `sdk/v3/derive.ts`. Roles are disjoint: a recovery key per epoch, a 32-byte seed per epoch, and operational keys derived from that seed. A holder of an epoch seed cannot compute the master, a recovery key, or another epoch's seed.

`fixtures/bunker-v3.json` holds public-test vectors. They are reproduced by the TypeScript client (`npx tsx scripts/v3-vectors.ts`), re-derived independently in Rust with RustCrypto's `hkdf`, verified with the vendored verifier, and accepted by the compiled program (`programs/bunker3-svm-tests/tests/client_vectors.rs`). The client and that check share one author; agreement shows consistency, not correctness.

## What is signed

Two message types, each `domain || program id || vault address || payload`, with distinct 16-byte domains, a role byte, and different lengths (PROTOCOL.md §3):

- an **announcement**, signed by the current operational key, fixing asset, mint, destination, amount, a deadline for landing, and the next operational root;
- a **recovery packet**, signed by the current epoch's recovery key, naming only the next recovery root and next operational root. For a given vault and epoch there is exactly one valid packet, and producing it again yields identical bytes. That determinism is what makes retrying it safe, and it is an assumption for review, not a proven property.

The hash signature authorizes these two instructions only. Fee payment, account creation and every other Solana transaction use ordinary Ed25519 signatures, as do validators, destination wallets, token authorities and, if the program is deployed upgradeable, the authority that can replace the program and with it every rule. **No end-to-end post-quantum security is claimed, and none may be.** What can be said: withdrawals and recovery are authorized by hash-based one-time signatures that rely only on SHA-256. What cannot: "quantum-safe", any security level, or any reference to a standard.

## Encrypted files

Recovery kit and day key use the same envelope (`sdk/v3/kit.ts`): scrypt (N = 2^17, r = 8, p = 1, from the pinned `@noble/hashes`) with a random 16-byte salt deriving an AES-256-GCM key, a random 12-byte IV, a 128-bit tag, and associated data `BUNKER3_KIT_TEST_V3:` followed by the JSON of the envelope header. The header states in the clear which kind of file it is, and that label is authenticated: a page expecting a day key refuses a recovery kit before deriving anything from the password typed, and relabelling a file makes decryption fail. Plaintext is the schema-ordered JSON of the file. After decryption the vault address is re-derived from the stored program and vault id, a recovery kit's vault identity is recomputed from its master, salt and waiting period, and a file of one kind is refused where the other is expected.

The two files have different passwords. The day key's is typed into the website; the recovery kit's is typed only into the offline tool, which refuses to give both the same one. A password is normalised to Unicode NFKC before use, so the same password typed on another system opens the file. The recovery kit's must be at least 16 characters with at least eight different ones; the day key's at least 12 with six. That is a floor against the worst choices, not a strength guarantee. scrypt at these settings makes each guess cost 128 MiB of memory and roughly a third of a second on a laptop, which removes most of the advantage of graphics cards, but a guessable password is still guessable: an attacker who copies the recovery kit and can spend real money needs to be facing five or more unrelated words, and the tool says so. An earlier draft used PBKDF2 at 600,000 iterations, which an internal estimate put at about 2^44 guesses per $100,000. There is no reset. JavaScript cannot reliably erase copies from memory.

## Passkey storage

`sdk/v3/passkey.ts` can store a day key in a browser, one record per vault. A platform credential is created with the WebAuthn PRF extension; its 32-byte output goes through HKDF-SHA256 to an AES-256-GCM key; the day key is encrypted with a random IV and associated data binding credential id, vault and epoch; only ciphertext is written to browser storage. A password manager may sync the credential to the user's other devices; the ciphertext does not travel with it. Opening a day key this way requires the same statement as opening the file, because the same key also exists as a file. The archival master is never stored this way. Tested with a simulated authenticator only.

## Signing journal

`sdk/v3/journal.ts` records, under a Web Lock, that `(epoch, index)` is reserved before any signature byte exists, then saves the signed announcement so an interrupted upload resumes the same bytes. A reservation with no saved signature, or an announcement past its deadline, is never signed again; the user recovers to a new epoch.

The journal only moves forward. It keeps the signed bytes of its most recent sixteen tuples and, permanently, the highest index it has reserved in each epoch. If the chain is reported at a tuple it has signed for, it offers those same bytes; if the chain is reported at or below anything it has reserved and it no longer holds the bytes, or at an earlier epoch, it refuses. Before reserving it checks that the reported operational root is the one its seed derives for that tuple, so a view of the vault cannot make it sign for a key that view did not come from, and it bounds the announcement deadline by the device clock. A journal it cannot parse is treated as a reason not to sign. Web Locks coordinate tabs in one browser profile only.

**A journal that is gone looks the same as one that was never written.** If site data is cleared, a private window is closed or the browser evicts storage after a key has signed and before that announcement lands, this browser will sign that key again. The page asks the browser for persistent storage and the statement required when opening a day key covers this case, but neither is enforcement. An announcement that fails to land should be followed by recovery, not by a retry from a clean browser. Two devices holding the same epoch seed can still sign different messages before either lands; the chain accepts at most one, and that does not make the second signature safe.

## Required external review

The upstream signature and Merkle commitment; whether a deterministic, re-emitted recovery signature is acceptable for it; the derivation and its context; constant-time behaviour; randomness; canonical encoding in both languages; the journal's crash windows and multi-device limits; the offline tool's separation from the site; rent, upgrade authority and token issuer risks. Passing tests is not an audit.
