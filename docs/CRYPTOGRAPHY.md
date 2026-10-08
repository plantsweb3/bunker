# Cryptographic construction and provenance

Status: experimental, unaudited. No production or post-quantum security level is asserted.

## Signature primitive

Withdrawals and recovery are authorized by **LM-OTS one-time signatures as specified in [RFC 8554](https://www.rfc-editor.org/rfc/rfc8554), section 4**, with the single parameter set `LMOTS_SHA256_N32_W8`: SHA-256, 32-byte values, 8-bit Winternitz digits, 34 hash chains (32 for the message digest, 2 for its checksum) of 255 steps, and a 1,124-byte signature `u32(4) || C || y[0..33]`. Every hash input follows the RFC byte for byte:

```
chain step   tmp = H( I || u32(q) || u16(i) || u8(j) || tmp )
message      Q   = H( I || u32(q) || 0x8181 || C || message )
public key   K   = H( I || u32(q) || 0x8080 || y[0] || ... || y[33] )
```

`I` is a 16-byte identifier and `q` a 32-bit number; together they name the key. Each chain step is hashed with its position, so within one key no two hash calls share an input, and two keys' calls can coincide only if the keys share `I` and `q`.

Two implementations were written separately against the RFC text: the verifier the program uses, `crates/bunker-lmots` (about a hundred lines, no dependency but the SHA-256 system call), and the client's `sdk/lmots.ts`, on pinned `@noble/hashes`. Both are checked against RFC 8554 Appendix F:

- **Verification**, against Test Case 1 (`fixtures/rfc8554-test-case-1.json`). It contains two LM-OTS signatures and no private key. Each must verify to a candidate public key that leads, through the Merkle path printed in the RFC, to the LMS public key printed in the RFC.
- **Key generation and signing**, against Test Case 2 (`fixtures/rfc8554-test-case-2.json`), whose second-level tree uses this parameter set and whose private key the RFC gives as a seed. Signing the RFC's message with that key and the RFC's randomizer must reproduce the RFC's signature byte for byte, and the key's public key must lead through the printed path to the printed LMS public key.

Both implementations share one author; the RFC vectors are the independent check. A second implementation by someone else is still wanted.

An earlier draft used a plain iterated-SHA-256 Winternitz construction adopted from prior work. It was replaced after the internal design review (finding D-6) because it had no positional tweaks, no published analysis and no test vectors from anyone else. The key-derivation label changed with it (`BUNKER-KDF-4`), so no key of this scheme shares bytes with a key of that one.

### How this use relates to the RFC, stated plainly

**The one-time signature is used on its own, in a chain.** RFC 8554 defines LM-OTS mainly as the leaf of a Merkle tree (LMS), and section 4 provides for its use outside one: "the value I MAY be used to differentiate this one-time signature from others; however, the value q MUST be set to the all-zero value." That is what is done here: `q` is always zero and `I` differs for every key. Each vault stores one LM-OTS public key per role, and every signed message names the public key that replaces it. A reader must not describe this as LMS or HSS, or as an implementation of a standard: it is the LM-OTS algorithms of that document, used as it permits, in a protocol of this project's own design. What the chain needs from the one-time scheme is what LMS needs from it: that nobody can produce a valid signature under a key that has signed at most one message. The analyses the RFC cites are of LMS as a whole; whether they carry over to this use is for an outside cryptographer.

**The identifier is derived, not random.** The program computes it from the vault it is verifying for:

```
I = first 16 bytes of SHA-256( "BUNKER3_LMOTS_ID" || program_id || chain_tag || salt || role || epoch (8, LE) || index (8, LE) )
q = 0
```

`index` is the operation index for an operational key and zero for a recovery key. `salt` is 32 random bytes chosen when the recovery kit is made and stored in the vault account. So a key is bound to one program, one chain, one vault salt, one role, one key generation and one position, and the verifier takes all of them from the vault, never from the signer. A signature made for any other position does not verify (tested against the compiled program for each of the six, and for a nonzero `q`).

Identifiers are not guaranteed unique across vaults. The salt is public once a vault exists, and the identifier does not include the vault's keys (it cannot: the vault's identity is computed from them). Someone can therefore create a vault whose keys share a victim's identifiers. This project found nothing they gain by it: their keys are their own, every signed message names its vault address, and the only effect is that two unrelated keys share hash-input prefixes, which the RFC (section 9.1) tolerates in small numbers. An honest owner's vaults never share a salt. Truncation to 16 bytes follows the RFC's size for `I`; an accidental collision between two positions has probability 2^-128.

**The randomizer is derived, and chosen to bound the verifier's work.** Algorithm 3 of the RFC draws `C` at random; this is the one step of Algorithms 1, 3 and 4b not followed as written. Here a derived one-time key is 1,120 bytes: the 34 chain starts, then a 32-byte seed. Candidate randomizers are `HKDF-SHA256(seed, info = "BUNKER-LMOTS-C" || n (4, LE))` for n = 0, 1, 2, ..., and the signer uses the first one for which verification takes at most 4,080 chain steps. The program refuses a signature that would take more (`VERIFY_STEP_LIMIT`). The number of steps is always 255 × (h + 2), where h is the high byte of the checksum, so the limit admits h ≤ 14, which a uniformly random digest satisfies with probability 0.283. The result:

- verification has a fixed ceiling: about 570,000 compute units for `announce` and 540,000 for `recover` at the limit, where the previous construction could need over a million. The heaviest transaction the client builds was measured at 603,000 of the 800,000 it requests;
- signing the same message with the same key always gives the same bytes, which is what lets the recovery packet be re-emitted (below);
- the randomizer is unknown to anyone without the key until the signature is published, as the RFC intends, but it is no longer independent of the message: it is selected by a public property of the digest. **Whether that selection is harmless is a question for the cryptographic review.** This project's reading is that it is: the limit only ever rejects, a signature inside it is an ordinary RFC 8554 signature, and a forger gains nothing from knowing that honest digests have a small checksum.

### What a single signature rests on

RFC 8554 (section 9) cites two analyses of LMS, which contains LM-OTS, in the random-oracle model (Katz 2016; Fluhrer 2017). Section 9.1 names the property they depend on: every hash input differs from all but a small bounded number of others somewhere in its first 23 bytes, the `I || q || i || j` prefix. This project has not verified those analyses, does not restate a security level from them, uses LM-OTS outside the LMS tree they cover, and chooses two of their inputs differently (the identifier and the randomizer, above). Whether their conclusions carry over is the first question for an outside cryptographer. No quantum-resistance claim is made: see the end of "What is signed".

### One key, one message

A one-time key must sign at most one message. Signing two different messages with one key makes forgery practical, not merely possible: each signature reveals every chain at the height of its digit, so two signatures reveal each chain at the lower of the two, and any digest whose digits (and checksum digits) are all at or above those heights can then be signed without the key. A forger chooses the randomizer freely, so they can keep the message they want and search randomizers. An internal estimate over 3,000 random pairs of in-limit digests puts the median work to find one near 2^42 SHA-256 evaluations, one pair in ten under 2^36 and one in a hundred under 2^32 (`scripts/two-signature-estimate.py`, an exact count of the digests that qualify for each pair; without the step limit the same script gives the 2^37 median measured earlier for the previous construction). These are estimates by this project, not a reviewed bound. The operational conclusion does not depend on the exact figure: **a key that may have signed twice is compromised, and the response is recovery**, which retires it. Everything in the protocol and client that looks like bookkeeping exists to keep a second signature from happening, or to recover when it is in doubt.

## Key derivation

One uniformly random 32-byte archival master derives every key with HKDF-SHA256 (RFC 5869), empty HKDF salt, and a fixed 241-byte context binding chain tag, program id, a random per-vault salt, the waiting period and the trusted destinations, followed by a role byte and little-endian indices. The vault's identity is the SHA-256 of a domain string, that salt, the chain tag, both genesis public keys, the waiting period and the trusted destinations (PROTOCOL.md §1.2); the program computes it and derives the vault address from it, so the address commits to the keys. The exact inputs are in [PROTOCOL.md](PROTOCOL.md) §1.1 and `sdk/v3/derive.ts`. Roles are disjoint: a recovery key per epoch, a 32-byte seed per epoch, and operational keys derived from that seed. A holder of an epoch seed cannot compute the master, a recovery key, or another epoch's seed.

`fixtures/bunker-v3.json` holds public-test vectors. They are reproduced by the TypeScript client (`npx tsx scripts/v3-vectors.ts`), re-derived independently in Rust with RustCrypto's `hkdf` (keys, public keys and all three signatures, byte for byte), verified with the program's verifier, and accepted by the compiled program (`programs/bunker3-svm-tests/tests/client_vectors.rs`). The client and that check share one author; agreement shows consistency, not correctness.

## What is signed

Two message types, each `domain || program id || vault address || payload`, with distinct 16-byte domains, a role byte, and different lengths (PROTOCOL.md §3):

- an **announcement**, signed by the current operational key, fixing asset, mint, destination, amount, a deadline for landing, and the next operational root;
- a **recovery packet**, signed by the current epoch's recovery key, naming only the next recovery root and next operational root. For a given vault and epoch there is exactly one valid packet, and producing it again yields identical bytes. That determinism is what makes retrying it safe, and it is an assumption for review, not a proven property.

The hash signature authorizes these two instructions only. Fee payment, account creation and every other Solana transaction use ordinary Ed25519 signatures, as do validators, destination wallets, token authorities and, if the program is deployed upgradeable, the authority that can replace the program and with it every rule. **No end-to-end post-quantum security is claimed, and none may be.** What can be said: withdrawals and recovery are authorized by hash-based one-time signatures (the LM-OTS construction of RFC 8554) whose security rests only on SHA-256; the system as a whole is not quantum-resistant; unaudited. What cannot: "quantum-safe", any security level, "LMS", "NIST", or "implements" or "complies with" any standard.

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

The LM-OTS implementations, and the three choices described above (one-time keys used in a chain outside LMS, the derived identifier, the derived and selected randomizer); whether a deterministic, re-emitted recovery signature is acceptable; the derivation and its context; constant-time behaviour; randomness; canonical encoding in both languages; the journal's crash windows and multi-device limits; the offline tool's separation from the site; rent, upgrade authority and token issuer risks. Passing tests is not an audit.
