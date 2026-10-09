# Architecture

Status: public beta on Solana mainnet, holding real funds. No independent audit. The program is upgradeable by its maintainer (docs/DEPLOYMENT.md).

## Parts

| Part | Where | Role |
|---|---|---|
| On-chain program | `programs/bunker3` | Holds assets and releases them only under the rules in [PROTOCOL.md](PROTOCOL.md) |
| Test-only forwarder | `programs/bunker3-cpi-probe` | Calls another program with what it is given, for cross-program tests. Never deployed |
| Signature verifier | `crates/bunker-lmots` | LM-OTS (RFC 8554 §4) candidate-key computation with a bound on its cost; see [CRYPTOGRAPHY.md](CRYPTOGRAPHY.md) |
| Client | `sdk/v3`, `sdk/lmots.ts` | Derivation, encodings, instructions, key files, signing journal, passkey storage |
| Offline recovery tool | `tools/recovery` | The only code that handles the archival master |
| Web app | `app`, `components/bunker` | Next.js App Router on Vercel |

## The program

Seven instructions, no administrator, no fee recipient, no arbitrary invocation, no close of a vault. The only instruction that debits a vault is `execute`, which takes no data and pays exactly what an earlier, signature-verified `announce` recorded, after the vault's own waiting period (which may be zero). `recover` installs new authorities from a fixed packet and never moves assets. Layouts, checks and the transition table are in PROTOCOL.md.

`src/state.rs` holds layouts and every transition as pure functions; `src/lib.rs` holds account validation, signature verification, spent markers and transfers.

## Keys and files

One 32-byte archival master derives everything (PROTOCOL.md §1). Two encrypted files exist, both AES-256-GCM under a key derived with scrypt (see CRYPTOGRAPHY.md):

- **Recovery kit** (archival): holds the master. Created once, never changes. Opened only by the offline tool.
- **Day key**: holds one epoch's seed. Opened by the vault page. Replaced whenever a recovery installs a new epoch.

Three public files cross between the offline tool and the site (`sdk/v3/requests.ts`): a network card, a creation request and a recovery packet. None contains a secret, and their schemas reject extra fields.

## The offline recovery tool

`scripts/build-recovery-tool.mjs` bundles `tools/recovery` into one HTML file, `public/source/bunker-recovery-tool.html`, at build time, and writes its SHA-256 to `recovery-tool-manifest.json`. The page's own Content Security Policy is `default-src 'none'; connect-src 'none'; form-action 'none'` with the inline script pinned by hash. The build is reproducible and its output is not committed.

CI builds the tool on every run, checks that a second build is byte-identical and prints its manifest. For commits on `main` it also uploads the file as a workflow artifact, kept 90 days, so there is a copy and a hash that do not come from the website. A scheduled workflow builds the tool from `main` daily and compares it with the file the site serves. It is served from the same domain as the site. A compromised site could serve a different file; the published hash and reproducible build let that be detected but nothing enforces it.

## Without the website

`tools/cli` is a command-line client over the same `sdk` code the site uses: read a Bunker, withdraw, resume, release, clear, submit a recovery packet. `scripts/build-cli.mjs` bundles it into a single file that needs only Node, published beside the offline tool with its hash. Its signing journal is a file beside the day key, written through a temporary file and a rename, with a lock file so two runs cannot sign at once. It takes the network and program from the day key file and refuses an RPC on any other network, and it on mainnet sends only to the published program, as the site does. It exists so that a Bunker does not depend on this website staying up.

`sdk/v3/master.ts` holds everything computed from the archival master, and `sdk/v3/core.ts` the addresses, vault identity and recovery-packet bytes with no Solana library. The offline tool is built from those and six other files and nothing else.

## The web app

Pages: `/`, `/vault`, `/recovery`, `/demo`, `/check`, `/integrate`, `/emergency`, `/security`, `/verify`, `/docs`, `/terms`, `/privacy`.

- `/vault` opens a Bunker with a day key (file and password, or a passkey saved in the browser), deposits SOL and classic SPL tokens, announces withdrawals (saying before anything is signed whether the destination is one of the vault's trusted addresses and so does not wait), shows the waiting period, releases or clears a withdrawal, and seals. “Bunker Mode” moves everything selected in the connected wallet into the vault in as few transactions as fit, leaving a small SOL reserve for fees. The activity log (`sdk/v3/history.ts`) is read back from the chain: it lists transactions that reference the vault’s address and names each from Bunker instructions that act on this vault (sent directly or made through another program) and the vault’s balance changes; it does not see a token sent directly to one of the vault’s token accounts by a third party. The signing journal (`sdk/v3/journal.ts`) reserves a one-time key before signing, never signs a reserved key again, and only moves forward: a chain view that goes back gets the bytes already signed or a refusal. The withdrawal shown for review is built once and is the object that is signed. The remedy for any doubt is recovery.
- `/recovery` hands out the offline tool and a network card, and submits a creation request or recovery packet after checking it against the chain. It never accepts a kit or a password. A creation request must hash to the address it names; creating is skipped if that vault already exists, and the vault is read back and compared before the page reports it built.
- `/check` is a read-only inventory of a pasted address (`sdk/exposure.ts`): SOL, classic SPL and Token-2022 accounts, and open delegations. It connects no wallet and stores nothing.
- `/demo` runs the browser signature code on a demo message; balances and the attacker are simulated.

Before a key is used, `sdk/preflight.ts` checks what is knowable in advance: a SOL destination that is a program or program-owned account, an amount that would leave the recipient below the rent minimum, a recipient token account that is frozen or mismatched, and a fee wallet that cannot pay. These reads trust the RPC and state can change afterwards.

Passkey storage (`sdk/v3/passkey.ts`) encrypts a day key with a key derived from the authenticator's WebAuthn PRF output and stores only ciphertext. It protects a day key at rest in one browser, one record per vault. It is not a backup.

## Server side

- `/api/config` reports network and release status, never credentials.
- `/api/rpc` proxies an allowlist of read methods (balances, accounts, token accounts, signatures for an address, and single transactions for the activity log) to one server-configured endpoint, refuses write methods in the production release, checks origin and request size, bounds list-shaped reads and the size of an answer, and applies timeouts. It limits each client address (as the platform reports it; an IPv6 /64 counts as one) to 300 requests a minute per server instance, which is a floor and not a firewall; add edge limits and a dedicated provider before wider use.
- `/api/verify` reports executable and upgrade-authority state for a configured test program. Source equivalence and audit status are reported as unverified until real evidence exists.
- `proxy.ts` attaches a per-request nonce Content Security Policy to every page. Paths it does not handle (`/api`, `/_next`, `/assets`, `/brand`, `/source`, share images, and exactly `/favicon.ico`, `/sitemap.xml` and `/robots.txt`) get a fixed policy from `next.config.ts` that runs and loads nothing, so their not-found pages are covered too. Everything under `/source` is served as a sandboxed download.
- The public source archive (`scripts/bundle-source.mjs`) is built from an allow-list of top-level entries and stops if anything inside them looks like key material.

## Alerts

Optional, and off unless every piece is configured (`lib/alerts/config.ts`): a Telegram bot token and username, a webhook secret, a cron secret, and an Upstash-compatible Redis REST endpoint. It is also off whenever no program is configured, so the read-only public site never advertises it.

- **Subscribing.** The vault page links to `https://t.me/<bot>?start=<vault address>`. Telegram delivers the message to `/api/telegram`, which checks Telegram's secret header, accepts only private chats, confirms on-chain that the address is a vault under the configured program, and stores the pair. `/list` and `/stop` are the only other commands. A chat may watch five vaults, a vault may have twenty watchers, and 5,000 vaults may be watched in all; a refusal says which limit it was. Anyone may watch any vault, so the last limit can be used up by someone determined; alerts are a convenience, not a guarantee.
- **Watching.** `vercel.json` schedules `/api/cron/watch` every minute; the route requires the cron secret. Each pass takes a lock and, until it has covered up to 1,000 watched vaults or 40 seconds have gone, takes the next 100 in turn, reads their accounts and their stored snapshots in one request each, compares each with the snapshot from the previous pass (`lib/alerts/watch.ts` `diff`), and sends one plain-text message per change to each subscriber. It does not read transactions, so traffic aimed at a vault can neither bury a change nor imitate one.
- **What is stored:** Telegram chat ids, the vault addresses each watches, and each vault's last reported public state. No keys, no wallet addresses, no message contents.
- **Limits.** Best effort. A pass can be late or fail; an event is reported after it is confirmed, so on a vault with no waiting period the alert for a withdrawal arrives after the assets have left. A delivery Telegram refuses is not retried. A crash mid-pass can repeat an alert. Token deposits and SOL arrivals under 0.001 SOL are not reported. Two changes between passes are reported as what they add up to. Anyone can subscribe to any vault's public activity. The subscription message says that silence is not proof nothing happened.

## Release gate

The default configuration is Solana mainnet and the one program address in `lib/bunker-config.ts`. No environment variable can name a different mainnet program: test writes need an explicit `localnet` or `devnet` selection, explicit enablement, a test program id and a pinned genesis, and both client and server refuse a mainnet genesis for any other configuration. Key files and network cards carry a network label that must agree with their genesis hash. A deployment owner could change source; the rule is a release policy, not an on-chain guarantee.

Asset names and prices are not read from chain metadata. A short fixed list in `sdk/known-mints.ts` labels well-known tokens by mint address; everything else is shown by mint.
