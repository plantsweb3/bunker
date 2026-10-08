# Threat model

Status: pre-release. No independent audit. Real-fund custody disabled.

## What is protected, and by what

A vault's SOL and classic SPL assets. Three secrets exist, with different reach:

| Secret | Held | If stolen |
|---|---|---|
| Wallet key (fee payer) | The user's everyday wallet | Nothing leaves the vault. It can pay fees and deposit. |
| Day key (one epoch's seed) and its password, or the passkey that unlocks it | The vault page, in one tab; optionally ciphertext in one browser's storage | The thief can announce withdrawals. With no waiting period they complete at once. With one, only those to the owner's trusted wallets do; for any other the owner has that long to recover. |
| Recovery kit (archival master) and its password | The offline tool only | Total. The thief can install their own keys. |

## Adversaries and failures

| Adversary or failure | Behaviour | Residual risk |
|---|---|---|
| Drainer site obtains a wallet signature | Cannot authorize an announcement | Whatever is still in the wallet is exposed |
| Seed phrase stolen | Does not derive any Bunker key | None for the vault |
| Amount, asset, destination, vault, program, epoch, index or next root altered | Signed bytes and verifier reject it | Correctness of both implementations and all account checks needs review |
| Someone else sends `initialize` for the owner's address first | The address is a hash of the creation data; other roots, another chain tag or another waiting period produce a different address | None. Identical data creates the owner's own vault. |
| A stranger builds a vault holding the owner's public roots and retires them there | Spent markers belong to one vault | None. An earlier draft shared markers across vaults; see [INTERNAL-REVIEW.md](INTERNAL-REVIEW.md) P-1. |
| Replay of a used signature | The root is retired at announcement; index and epoch no longer match | Fork or rollback behaviour needs analysis |
| Day key stolen, vault has a waiting period | The thief can send at once only to the vault's trusted wallets, which are the owner's. A withdrawal anywhere else is visible on-chain and waits; recovery cancels it and kills the key | The owner must notice in time: Telegram alerts are optional, best effort, and depend on the project's server, Telegram and an RPC provider. A trusted wallet the thief also controls defeats this, so trusted wallets should be ones a compromise of the everyday device does not reach. "Returns the assets to the owner" assumes wallets whose keys the owner holds: a thief can push every asset to a trusted address at once and irreversibly, and an exchange deposit address may not credit a token it does not list or an amount below its minimum. |
| Day key stolen, vault has **no** waiting period | Nothing | Immediate loss. The tool starts on a 24-hour wait; choosing none requires accepting a statement that says this. |
| A trusted address was mistyped, or the owner loses access to it | The tool makes the owner accept a statement naming the count and that every character was checked; the list is shown on the site before the vault is built | The list cannot be changed. A withdrawal to a wrong trusted address is immediate and lost. A lost trusted wallet is merely unused. |
| Day key lost, passkey or device lost | Recovery kit re-issues a day key or installs a new epoch | None while the kit exists |
| Signed announcement never lands, tab closed mid-signing | Journal refuses to sign that key again; recovery installs a new epoch | None while the kit exists |
| Day key stolen and the thief has read a recovery packet, for this key generation or a later one | Recovery neither reads nor marks the operational root, so nothing the day key does can make a packet fail | None beyond the row above. Two earlier drafts let the thief block this recovery, then a future one; see [INTERNAL-REVIEW.md](INTERNAL-REVIEW.md) P-8 and P-11. |
| A pending withdrawal that cannot execute (recipient token account closed or frozen) | The mint and its decimals are checked when the withdrawal is announced, so an unsupported or mistyped token is refused then. Otherwise nothing moves; it expires after the waiting period again or one day, whichever is longer, or recovery clears it | The Bunker can make no other withdrawal until then unless the owner spends a recovery. |
| Browser storage cleared between signing and landing | The page requests persistent storage; opening a day key requires a statement that covers it | The journal is gone, so the same key can sign again. Same consequence as two devices. |
| Same day key used on two devices | Journal cannot see the other device; opening a key, by file or by passkey, requires a statement from the user | Two signatures under one key are possible. The chain accepts one. Two different signed messages under one key make forging a third practical ([CRYPTOGRAPHY.md](CRYPTOGRAPHY.md)); the remedy is recovery, which retires that key. |
| Recovery kit lost, with its password or not | No administrator, no reset | The day key keeps working until it is lost or a recovery is needed; then assets are unrecoverable |
| Malicious website deployment, dependency or extension | Per-request nonce CSP, pinned dependencies; the day key has its own password, which the tool refuses to make equal to the recovery kit's | Can steal a day key opened on the site and alter what is shown. Cannot obtain the master or its password, which the site never handles. |
| Malicious or substituted offline tool | Published hash, reproducible build (also built by CI, and compared daily with the file the site serves), a bundle small enough to read, page policy forbidding connections; served only as a download, sandboxed, and it refuses to run unless opened from a saved file | Served from the same domain as the site; a user who does not check the hash is exposed. The page policy stops honest code from connecting; it does not stop a malicious script in a substituted tool from navigating the page to an address that carries a secret. A tool that cannot connect can still write a malicious file. |
| Offline tool run on a compromised or online device | The tool warns when online | Not an air gap. Malware can read the kit and its password. |
| Dishonest RPC | Genesis pinned; a recovery packet's signature is checked against the on-chain commitment before submission; the vault address is derived from the user's own files; the journal signs only for the root the day key derives, never twice for one key whatever order states are shown in, and bounds the deadline by the device clock | Can lie about balances, token decimals, state and time shown to the user, withhold transactions, and so delay or mislead. A waiting period that differs from the day key's is refused. Cannot obtain a second signature under a key or send a deposit to a vault with other keys. |
| Token issuer freezes an account | Frozen balances are not offered; a failed release stays retryable | A frozen recipient account blocks that withdrawal until it thaws or is cancelled |
| Program upgraded maliciously | The policy is to deploy the real-funds program immutable and publish proof ([DEPLOYMENT.md](DEPLOYMENT.md)) | None once that is done and verified. Until then nothing is deployed. An immutable program also cannot be fixed: a flaw found later is met by users withdrawing and a successor at a new address. |
| Solana consensus, validators, clock | Trusted | Waiting periods use validator-reported time |
| Someone tries to hide or fake an alert with transactions | Alerts are derived from changes in the vault account itself, which only the program can change | None from traffic. Dust below 0.001 SOL is not reported. |
| Alert service compromised or impersonated | It holds no keys and cannot move assets; messages are plain text and state that Bunker never asks for a key | Its operator, its RPC provider or Telegram can silence it or make it send false alarms. A fake bot can phish. Alerts name bunkermode.io/recovery, which never accepts a kit. |

## What the waiting period and trusted addresses are

Chosen when a vault is created, fixed for that vault and part of its address. The waiting period applies to every withdrawal except those to the vault's trusted wallets (at most four). It is the only protection against a stolen day key. Without it, a Bunker protects against theft of the wallet key and seed phrase and against a bad signature in the wallet, and not against theft of the day key. With it, a stolen day key can pay only the owner's own trusted wallets without waiting. The reference tool starts on 24 hours.

## Explicit non-goals

No Bitcoin custody, private balances, swaps, yield, staking, relayer, arbitrary program invocation, Token-2022, multisig policy, social recovery or pre-approved destinations. No audit, insurance, formal proof or quantified post-quantum claim.

## Before real funds

Independent cryptographic assessment and program audit; remediation; a decision on the open questions in [PROTOCOL.md](PROTOCOL.md); distribution of the offline tool independent of the website; testing on real devices; an independently reproducible deployed binary; a published upgrade-authority policy; and a named incident owner. Public source alone satisfies none of these.
