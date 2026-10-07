# Architecture

The frontend uses React/TypeScript and Next.js App Router on Vercel. Seven routes: `/`, `/vault`, `/demo`, `/check`, `/security`, `/verify`, `/docs`. `/check` is a read-only inventory of a pasted address: SOL balance, classic SPL and Token-2022 token accounts, and open token delegations, read through the existing `/api/rpc` allowlist (`getBalance`, `getTokenAccountsByOwner`). It connects no wallet, signs nothing, stores nothing, and infers no names or prices; `sdk/exposure.ts` holds the classification and is unit tested. The address may be supplied as `/check?a=<address>` so a result can be linked; the landing page form submits there. `sdk/known-mints.ts` labels a short fixed list of well-known tokens by mint address only. `app/opengraph-image.tsx` renders the link-preview card at build time from the repository's own mark and font. The recovery signer is separated in `sdk/` but still runs in the same browser origin and bundle trust boundary. No production signer isolation is claimed.

`/api/config` exposes network and release status, never RPC credentials. `/api/rpc` proxies an allowlist to one server-configured endpoint, rejects write methods in the production release, enforces origin and request-size checks, and applies upstream timeouts. It is not a durable rate limiter: add edge limits and a dedicated RPC provider before broader publication. The public website is a read-only pre-release.

`/api/verify` reads executable and upgrade-authority state only for the configured test program. Source equivalence and audit status always remain unverified until actual external evidence is supplied.

## On-chain surface

Four instructions in `programs/bunker/src/lib.rs`:

0. Initialize: derive PDA `[b"bunker", random_id_32]`, fund/allocate/assign it and store a root with no spent marker. Handles prefunding of the PDA. Requires fee payer signature, never creates a wallet-based withdrawal backdoor.
1. Stage: proof PDA `[b"proof", fee_payer, SHA256(canonical_message)]`. Two append-only chunks, at most 600 bytes each. Identical chunks can retry. Buffer is bounded to 1,088 signature bytes plus 74 metadata bytes. This publishes a signature, never a secret preimage.
2. Withdraw: fixed SOL or classic SPL checked transfer after full signature verification. Checks protocol version, fixed length, expiry against Clock, vault owner/PDA/magic/id/nonce/root, proof owner/magic/length/digest, destination, token program, mint, source owner, delegate/close authority, and rent. Creates a permanent spent-root marker, rejects a spent next root, and advances root and nonce atomically with the transfer. Every remaining asset is under the next authority. No generic CPI routing, arbitrary programs, admin override, token extensions, or relayer.
3. Close proof: the uploading payer can reclaim its buffer rent. This is a public-signature account, not a vault, and cannot move vault funds. Successful client withdrawals close it in the same final transaction; interrupted uploads may be closed separately through SDK after diagnosis. Closing a buffer does NOT revoke the signature or permit a different signature with the same key.

Protocol 2 uses vault magic `BUNKER02`, proof magic `BKPROOF2`, and spent-marker magic `BKSPENT2`. Spent markers are 8-byte program-owned PDAs `[b"spent-v2", root]`, never closable. They add permanent per-withdrawal rent funded by the fee payer.

Vault data is 81 bytes: magic(8), identity(32), root(32), nonce(8 LE), bump(1). Proof data is 1,162 bytes: magic(8), payer(32), message digest(32), used length(2 LE), signature(1,088). Vault rent is intentionally not closable. Standard SPL ATA rent is not reclaimed by this release. Deposits use System/SPL/ATA programs directly.

## Client safety

All amounts are parsed into bigint; exponent notation, negatives, excessive decimals and u64 overflow are rejected. RPC SOL numbers beyond JS's safe integer range fail closed. Transactions remain <=1,232 bytes. Transactions simulate before signing and compare the wallet-returned message bytes to the reviewed message. Genesis is checked before signing and before sending. Confirmation errors retain transaction signatures and pending recovery data; resume checks chain authority before retrying.

Only ordinary on-curve wallet recipients are supported by the web withdrawal UI. For SPL, the exact recipient ATA is signed and the ATA may be created idempotently in the final transaction. Asset names and prices are not inferred; unknown assets display mint identifiers, not potentially spoofed metadata.

The canonical signed layout and exact recovery transitions are in `CRYPTOGRAPHY.md`. The v2 encrypted recovery blob is checked against the persistent journal and chain. Signing consumes the journal before cryptographic work; retries load a saved signature. Expiry/failure never resets that consumed state. Web Locks do not synchronize devices or protect against storage rollback.

## Compatibility

Protocol 2 is a breaking test-only format. The payload is 154 bytes and adds version, vault identity and expiry. Vault/proof magic and encrypted recovery envelopes reject v1. There is no automatic migration or reinterpretation of old test keys. Use a fresh isolated ledger and fresh valueless assets for v2; preserve any v1 experiment separately. Do not upgrade an existing program/ledger in place without a reviewed migration.

## Production gate

Default is mainnet read-only. No variable turns on mainnet custody. Test writes need explicit localnet/devnet selection, explicit enablement, a test program ID, and pinned genesis. Client and server enforce the restriction. A deployment owner could change source; this gate is a release policy, not an on-chain security proof. The experimental program can technically be deployed elsewhere by someone with its source, but doing so does not create an approved release.
