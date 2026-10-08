# Threat model

Status: pre-release. No independent audit. Real-fund custody disabled.

## What is protected, and by what

A vault's SOL and classic SPL assets. Three secrets exist, with different reach:

| Secret | Held | If stolen |
|---|---|---|
| Wallet key (fee payer) | The user's everyday wallet | Nothing leaves the vault. It can pay fees and deposit. |
| Day key (one epoch's seed) and its password, or the device passkey that unlocks it | The vault page, in one tab; optionally ciphertext on one device | The thief can announce withdrawals. With no waiting period they complete at once. With one, the owner has that long to recover. |
| Recovery kit (archival master) and its password | The offline tool only | Total. The thief can install their own keys. |

## Adversaries and failures

| Adversary or failure | Behaviour | Residual risk |
|---|---|---|
| Drainer site obtains a wallet signature | Cannot authorize an announcement | Whatever is still in the wallet is exposed |
| Seed phrase stolen | Does not derive any Bunker key | None for the vault |
| Amount, asset, destination, vault, program, epoch, index or next root altered | Signed bytes and verifier reject it | Correctness of both implementations and all account checks needs review |
| Replay of a used signature | The root is retired at announcement; index and epoch no longer match | Fork or rollback behaviour needs analysis |
| Day key stolen, vault has a waiting period | Withdrawal is visible on-chain and waits; recovery cancels it and kills the key | The owner must notice in time. No alert service exists yet. |
| Day key stolen, vault has **no** waiting period | Nothing | Immediate loss. This is the default and is stated when a vault is created. |
| Day key lost, passkey or device lost | Recovery kit re-issues a day key or installs a new epoch | None while the kit exists |
| Signed announcement never lands, tab closed mid-signing | Journal refuses to sign that key again; recovery installs a new epoch | None while the kit exists |
| Same day key used on two devices | Journal cannot see the other device; opening a key requires a statement from the user | Two signatures under one key are possible. The chain accepts one; forgery risk after a double signature is not eliminated. |
| Recovery kit lost, with its password or not | No administrator, no reset | The day key keeps working until it is lost or a recovery is needed; then assets are unrecoverable |
| Malicious website deployment, dependency or extension | Per-request nonce CSP, pinned dependencies | Can steal a day key opened on the site and alter what is shown. Cannot obtain the master, which the site never handles. |
| Malicious or substituted offline tool | Published hash, reproducible build, page policy forbidding connections | Served from the same domain as the site; a user who does not check the hash is exposed. A tool that cannot connect can still write a malicious file. |
| Offline tool run on a compromised or online device | The tool warns when online | Not an air gap. Malware can read the kit and its password. |
| Dishonest RPC | Genesis pinned; a recovery packet's signature is checked against the on-chain commitment before submission | Can lie about balances, state and time shown to the user |
| Token issuer freezes an account | Frozen balances are not offered; a failed release stays retryable | A frozen recipient account blocks that withdrawal until it thaws or is cancelled |
| Program upgraded maliciously | Upgrade authority is disclosed per deployment | An upgradeable program can change every rule. The policy for the authority is undecided. |
| Solana consensus, validators, clock | Trusted | Waiting periods use validator-reported time |

## What the waiting period is

Optional, chosen when a vault is created, fixed for that vault, off by default. It is the only protection against a stolen day key. Without it, a Bunker protects against theft of the wallet key and seed phrase and against a bad signature in the wallet, and not against theft of the day key.

## Explicit non-goals

No Bitcoin custody, private balances, swaps, yield, staking, relayer, arbitrary program invocation, Token-2022, multisig policy, social recovery, pre-approved destinations or alerts. No audit, insurance, formal proof or quantified post-quantum claim.

## Before real funds

Independent cryptographic assessment and program audit; remediation; a decision on the open questions in [PROTOCOL.md](PROTOCOL.md); distribution of the offline tool independent of the website; testing on real devices; an independently reproducible deployed binary; a published upgrade-authority policy; and a named incident owner. Public source alone satisfies none of these.
