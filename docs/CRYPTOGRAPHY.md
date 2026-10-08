# Cryptographic construction and provenance

Status: experimental, unaudited. No production or post-quantum security level is asserted.

## Signature primitive

The source in `crates/winterwallet-core/src` is copied without algorithmic edits from Blueshift Winterwallet commit `672fc6789b1532ee680f24842d235e0be8737b61`, https://github.com/blueshift-gg/winterwallet (MIT; Dean Little). The manifest is adapted to this workspace. Its own README says it is not formally audited. Its claims are not adopted as independent assurance.

Bunker selects N=32, the full SHA-256 message digest. There are 32 message scalars and two checksum scalars, each 32 bytes. Chains perform SHA-256 up to 255 times; the checksum is sum(255 - digest[i]), encoded as two big-endian digits. Public chain endpoints are committed with tagged Merkle leaves SHA256(0x00 || endpoint) and nodes SHA256(0x01 || left || right), duplicating the rightmost node on odd levels. A signature is 1,088 bytes. This is the upstream Winternitz construction, NOT WOTS+, LMS, XMSS, or an asserted NIST-approved scheme.

`sdk/winternitz.ts` is a TypeScript port using pinned `@noble/hashes` SHA-256. `fixtures/winterwallet-n32.json` is generated from a PUBLIC TEST mnemonic and compared byte for byte in tests. `vendor/winterwallet-revision.json` pins every upstream algorithm file's SHA-256; tests reject drift. Bunker does not use the upstream mnemonic derivation.

A one-time key must sign at most one message. Signing two different messages with one key can permit forgery. Everything in the protocol and client that looks like bookkeeping exists to keep that true, or to recover when it is in doubt.

## Key derivation

One uniformly random 32-byte archival master derives every key with HKDF-SHA256 (RFC 5869), empty salt, and a fixed 109-byte context binding chain tag, program id and vault id, followed by a role byte and little-endian indices. The exact inputs are in [PROTOCOL.md](PROTOCOL.md) §1.1 and `sdk/v3/derive.ts`. Roles are disjoint: a recovery key per epoch, a 32-byte seed per epoch, and operational keys derived from that seed. A holder of an epoch seed cannot compute the master, a recovery key, or another epoch's seed.

`fixtures/bunker-v3.json` holds public-test vectors. They are reproduced by the TypeScript client (`npx tsx scripts/v3-vectors.ts`), re-derived independently in Rust with RustCrypto's `hkdf`, verified with the vendored verifier, and accepted by the compiled program (`programs/bunker3-svm-tests/tests/client_vectors.rs`). The client and that check share one author; agreement shows consistency, not correctness.

## What is signed

Two message types, each `domain || program id || vault address || payload`, with distinct 16-byte domains, a role byte, and different lengths (PROTOCOL.md §3):

- an **announcement**, signed by the current operational key, fixing asset, mint, destination, amount, a deadline for landing, and the next operational root;
- a **recovery packet**, signed by the current epoch's recovery key, naming only the next recovery root and next operational root. For a given vault and epoch there is exactly one valid packet, and producing it again yields identical bytes. That determinism is what makes retrying it safe, and it is an assumption for review, not a proven property.

The hash signature authorizes these two instructions only. Fee payment, account creation and every other Solana transaction use ordinary signatures. No end-to-end post-quantum security is claimed.

## Encrypted files

Recovery kit and day key use the same envelope (`sdk/v3/kit.ts`): Web Crypto PBKDF2-SHA256 with 600,000 iterations and a random 16-byte salt deriving an AES-256-GCM key, a random 12-byte IV, a 128-bit tag, and associated data `BUNKER3_KIT_TEST_V1:` followed by the JSON of the envelope header. Plaintext is the schema-ordered JSON of the file. After decryption the vault address is re-derived from the stored program and vault id, and a file of one kind is refused where the other is expected. Password strength matters; there is no reset. JavaScript cannot reliably erase copies from memory.

## Passkey storage

`sdk/v3/passkey.ts` can store a day key on a device. A platform credential is created with the WebAuthn PRF extension; its 32-byte output goes through HKDF-SHA256 to an AES-256-GCM key; the day key is encrypted with a random IV and associated data binding credential id, vault and epoch; only ciphertext is written to browser storage. The archival master is never stored this way. Tested with a simulated authenticator only.

## Signing journal

`sdk/v3/journal.ts` records, under a Web Lock, that `(epoch, index)` is reserved before any signature byte exists, then saves the signed announcement so an interrupted upload resumes the same bytes. A reservation with no saved signature, or an announcement past its deadline, is never signed again; the user recovers to a new epoch. Web Locks coordinate tabs in one browser profile only. Two devices holding the same epoch seed can still sign different messages before either lands; the chain accepts at most one, and that does not make the second signature safe.

## Required external review

The upstream signature and Merkle commitment; whether a deterministic, re-emitted recovery signature is acceptable for it; the derivation and its context; constant-time behaviour; randomness; canonical encoding in both languages; the journal's crash windows and multi-device limits; the offline tool's separation from the site; rent, upgrade authority and token issuer risks. Passing tests is not an audit.
