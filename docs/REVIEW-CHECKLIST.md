# External review request

No reviewer has been engaged, no report has been obtained, and no audit badge may be displayed.

Scope includes the full repo and its dependency lockfiles, especially:

- Upstream Winterwallet SHA-256 Winternitz scheme, N=32, checksum and Merkle tree; distinguish prior art from standardized or reviewed construction.
- Exact correspondence of browser signer and Rust verifier, including independent test vectors beyond our fixture.
- Mutable program owner/PDA/account alias validation, SOL rent, classic SPL mint/owner/delegate/close authority, errors and CPI atomicity.
- Fuzz instruction lengths, account counts, integer bounds, oversized chunks, partial buffers, duplicate metas and adversarial token states.
- Permanent spent-root markers, failed-transaction rollback, root-reinstallation rejection, slot-boundary expiry and atomic authority over every remaining asset.
- Browser signing journal crash windows, persistent storage failure, same-origin races, stale recovery files, multi-device state and chain rollback.
- Recipient binding, trust in RPC, encrypted file parsing and KDF, frontend compromise, supply-chain build provenance and signer isolation.
- Irrecoverable pending authorizations after token freezes or permanent transfer failures; expiry is enforced, with no cancellation or expiry recovery escape hatch.
- Domain separation for a reviewed production deployment and independently reproducible program build.
- Upgrade policy, incident response, authenticated release process, security contact, audit scope disclosure and bounty.

Release requirements: written cryptographic assessment, independent program audit, remediation verification, signer/recovery decision, reproducible build evidence, program/authority publication, operational ownership, and a deliberate source change to enable real-fund custody. Do not turn these into checkmarks without evidence.
