# Threat model

## Assets and trust boundaries

Protect the vault's SOL/classic SPL assets, independent one-time signing material, next authorization key, and the association between a user's intended transfer and program execution. Passwords protect exported recovery ciphertext; they do not attest to the application, RPC or on-chain state.

The fee wallet is separate from withdrawal authority. The browser, downloaded JavaScript, origin storage, Web Crypto implementation, wallet extension and RPC all participate in the current test workflow. A separate file in the same compromised browser is not an isolated signer.

| Adversary or failure | Current behavior | Residual risk |
|---|---|---|
| Fee-wallet key stolen alone | Cannot produce the independent vault authorization | It may still pay to submit an already published exact authorization |
| Recipient, amount, asset, vault, program, nonce, expiry slot or next root modified | Canonical signed context and verifier reject mismatch | Review correctness of both implementations and all account validation |
| A withdrawal is replayed after success | Root/nonce no longer match and a permanent spent-root marker forbids reinstalling it | Chain rollback/forks and copied key state require independent analysis |
| Partial proof publication / lost connection | Saved chunks and exact signature can be resumed from the pending file before expiry | Never replace it with a different authorization under the old key |
| Stale backup, multiple devices or cleared storage | Explicit import checks a persistent one-origin journal; different local intents cannot sign after consumption | Unsafe one-time-key reuse is not solved; blocks real-fund release |
| Malicious frontend / dependency / extension | CSP and pinned dependencies reduce some injection opportunities | The origin can still steal signing keys; isolated production signing remains unresolved |
| Dishonest RPC | Chain genesis and account constraints are checked where possible | Genesis response itself is trusted; an RPC can lie about balances or state |
| Token freeze / issuer behavior | Only classic SPL is accepted; frozen accounts are not offered for transfer | Issuer actions can strand an already authorized transfer; expiry invalidates the signature but does not recover the vault; there is no cancellation path |
| Program upgrade / validator or consensus failure | Trust boundary disclosed | No claim that the entire Solana stack is quantum-resistant or immutable |
| Lost file/password/next key | No administrative recovery backdoor | Assets can become permanently inaccessible |
| Anonymous RPC endpoint abuse | Method allowlist, bounded bodies, timeouts and origin checks | Edge/provider quotas and monitoring remain required operational controls |

## One-time state, split-brain and failure

Signing consumes the current index and advances the journal before submission. An unconfirmed, failed or expired authorization is never assumed unused. The encrypted blob, journal and chain commitment must agree before signing; divergent state fails closed. Reconciliation adopts the next secret only when both the chain root and nonce match the saved transition. A crash after consumption but before saving the signed blob can be unrecoverable.

A browser lock does not protect against a second device, cleared storage, malicious frontend, restored profile or chain rollback. Stale backups can still split-brain. Our same-origin tests demonstrate refusal to double-sign with intact shared storage. Our separate-restored-copy validator test demonstrates at most one accepted withdrawal, **not** global prevention of signing twice or of forgery after unsafe key reuse. No such global guarantee is claimed.

On-chain failure is atomic, but off-chain disclosure is irreversible. Until an exact retry succeeds, value can remain under the old revealed commitment. There is no safe replacement, cancel or emergency recovery in this release. Expiry or a permanently frozen token destination can strand all remaining assets, including other assets under the same authority. After success, the entire vault authority rotates in the same instruction; no successful partial transfer leaves a remainder under the spent authority.

The program does not stop someone initializing two vaults under the same still-unspent root. Once either consumes that root, its marker prevents any later spend from either. The SDK generates fresh random authority material; manually reusing active roots can permanently lock the other vault. Cloning identical program/vault/root state to another test chain also lies outside per-chain one-time enforcement.

The fee wallet signs fees/account creation, and the Solana runtime still relies on ordinary signatures. Hash authorization applies only to this vault instruction. It is not end-to-end post-quantum security.

## Explicit non-goals

No Bitcoin custody, shielded transfers, private balances, token swaps, yield, relayer, arbitrary program invocation, Token-2022 extensions, multisig policy or social recovery. No audit, insurance, formal proof or quantified post-quantum security claim.

## Before real funds

External cryptographic assessment and program audit, remediation, adversarial testing, a durable signer-state architecture, rollback analysis, independently reproducible deployed binary, published upgrade policy and an operational incident owner are required. See the release checklist. Public source alone does not satisfy any of those requirements.
