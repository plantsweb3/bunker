# Architecture

Status: pre-release. Nothing is deployed on mainnet, no independent audit is complete, and real-fund custody is disabled.

## Parts

| Part | Where | Role |
|---|---|---|
| On-chain program | `programs/bunker3` | Holds assets and releases them only under the rules in [PROTOCOL.md](PROTOCOL.md) |
| Signature verifier | `crates/winterwallet-core` | Vendored unchanged; see [CRYPTOGRAPHY.md](CRYPTOGRAPHY.md) |
| Client | `sdk/v3`, `sdk/winternitz.ts` | Derivation, encodings, instructions, key files, signing journal, passkey storage |
| Offline recovery tool | `tools/recovery` | The only code that handles the archival master |
| Web app | `app`, `components/bunker` | Next.js App Router on Vercel |

## The program

Seven instructions, no administrator, no fee recipient, no arbitrary invocation, no close of a vault. The only instruction that debits a vault is `execute`, which takes no data and pays exactly what an earlier, signature-verified `announce` recorded, after the vault's own waiting period (which may be zero). `recover` installs new authorities from a fixed packet and never moves assets. Layouts, checks and the transition table are in PROTOCOL.md.

`src/state.rs` holds layouts and every transition as pure functions; `src/lib.rs` holds account validation, signature verification, spent markers and transfers.

## Keys and files

One 32-byte archival master derives everything (PROTOCOL.md §1). Two encrypted files exist, both AES-256-GCM under PBKDF2-SHA256 (see CRYPTOGRAPHY.md):

- **Recovery kit** (archival): holds the master. Created once, never changes. Opened only by the offline tool.
- **Day key**: holds one epoch's seed. Opened by the vault page. Replaced whenever a recovery installs a new epoch.

Three public files cross between the offline tool and the site (`sdk/v3/requests.ts`): a network card, a creation request and a recovery packet. None contains a secret, and their schemas reject extra fields.

## The offline recovery tool

`scripts/build-recovery-tool.mjs` bundles `tools/recovery` into one HTML file, `public/source/bunker-recovery-tool.html`, at build time, and writes its SHA-256 to `recovery-tool-manifest.json`. The page's own Content Security Policy is `default-src 'none'; connect-src 'none'; form-action 'none'` with the inline script pinned by hash. The build is reproducible and its output is not committed.

CI builds the tool on every run, checks that a second build is byte-identical, prints its manifest and uploads the file as a workflow artifact, so there is a copy and a hash that do not come from the website. It is served from the same domain as the site. A compromised site could serve a different file; the published hash and reproducible build let that be detected but nothing enforces it.

## The web app

Routes: `/`, `/vault`, `/recovery`, `/demo`, `/check`, `/integrate`, `/emergency`, `/security`, `/verify`, `/docs`, `/terms`, `/privacy`.

- `/vault` opens a Bunker with a day key (file and password, or a passkey saved on the device), deposits SOL and classic SPL tokens, announces withdrawals, shows the waiting period, releases or clears a withdrawal, and seals. “Bunker Mode” moves everything selected in the connected wallet into the vault in as few transactions as fit, leaving a small SOL reserve for fees. The activity log (`sdk/v3/history.ts`) is read back from the chain: it lists transactions that reference the vault’s address and names each from the program’s own instruction opcodes and the vault’s balance changes; it does not see a token sent directly to one of the vault’s token accounts by a third party. The signing journal (`sdk/v3/journal.ts`) reserves a one-time key before signing and never signs a reserved key again; the remedy for any doubt is recovery.
- `/recovery` hands out the offline tool and a network card, and submits a creation request or recovery packet after checking it against the chain. It never accepts a kit or a password.
- `/check` is a read-only inventory of a pasted address (`sdk/exposure.ts`): SOL, classic SPL and Token-2022 accounts, and open delegations. It connects no wallet and stores nothing.
- `/demo` runs the browser signature code on a demo message; balances and the attacker are simulated.

Before a key is used, `sdk/preflight.ts` checks what is knowable in advance: a SOL destination that is a program or program-owned account, an amount that would leave the recipient below the rent minimum, a recipient token account that is frozen or mismatched, and a fee wallet that cannot pay. These reads trust the RPC and state can change afterwards.

Passkey storage (`sdk/v3/passkey.ts`) encrypts a day key with a key derived from the authenticator's WebAuthn PRF output and stores only ciphertext. It protects a day key at rest on one device. It is not a backup.

## Server side

- `/api/config` reports network and release status, never credentials.
- `/api/rpc` proxies an allowlist of read methods (balances, accounts, token accounts, signatures for an address, and single transactions for the activity log) to one server-configured endpoint, refuses write methods in the production release, checks origin and request size, and applies timeouts. It is not a rate limiter; add edge limits and a dedicated provider before wider use.
- `/api/verify` reports executable and upgrade-authority state for a configured test program. Source equivalence and audit status are reported as unverified until real evidence exists.
- `proxy.ts` attaches a per-request nonce Content Security Policy to every document response.

## Release gate

The default configuration is mainnet read-only. No environment variable enables mainnet custody: test writes need an explicit `localnet` or `devnet` selection, explicit enablement, a test program id and a pinned genesis, and both client and server refuse a mainnet genesis for writes. A deployment owner could change source; the gate is a release policy, not an on-chain guarantee.

Asset names and prices are not read from chain metadata. A short fixed list in `sdk/known-mints.ts` labels well-known tokens by mint address; everything else is shown by mint.
