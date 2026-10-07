# Threat model

## Assets and trust boundaries

Protect the vault's SOL/classic SPL assets, independent one-time signing material, next authorization key, and the association between a user's intended transfer and program execution. Passwords protect exported recovery ciphertext; they do not attest to the application, RPC or on-chain state.

The fee wallet is separate from withdrawal authority. The browser, downloaded JavaScript, origin storage, Web Crypto implementation, wallet extension and RPC all participate in the current test workflow. A separate file in the same compromised browser is not an isolated signer.

| Adversary or failure | Current behavior | Residual risk |
|---|---|---|
| Fee-wallet key stolen alone | Cannot produce the independent vault authorization | It may still pay to submit an already published exact authorization |
| Recipient, amount, asset, vault, program, nonce or next root modified | Canonical signed context and verifier reject mismatch | Review correctness of both implementations and all account validation |
| A withdrawal is replayed after success | Root and nonce no longer match | Chain rollback/forks and copied key state require independent analysis |
| Partial proof publication / lost connection | Same chunks and exact transfer can be resumed from the pending file | Never replace it with a different authorization under the old key |
| Stale backup, multiple devices or cleared storage | One-origin journal provides only limited coordination | Unsafe one-time-key reuse is not solved; blocks real-fund release |
| Malicious frontend / dependency / extension | CSP and pinned dependencies reduce some injection opportunities | The origin can still steal signing keys; isolated production signing remains unresolved |
| Dishonest RPC | Chain genesis and account constraints are checked where possible | Genesis response itself is trusted; an RPC can lie about balances or state |
| Token freeze / issuer behavior | Only classic SPL is accepted; frozen accounts are not offered for transfer | Issuer actions can strand an already authorized transfer; no expiry/cancel path |
| Program upgrade / validator or consensus failure | Trust boundary disclosed | No claim that the entire Solana stack is quantum-resistant or immutable |
| Lost file/password/next key | No administrative recovery backdoor | Assets can become permanently inaccessible |
| Anonymous RPC endpoint abuse | Method allowlist, bounded bodies, timeouts and origin checks | Edge/provider quotas and monitoring remain required operational controls |

## Explicit non-goals

No Bitcoin custody, shielded transfers, private balances, token swaps, yield, relayer, arbitrary program invocation, Token-2022 extensions, multisig policy or social recovery. No audit, insurance, formal proof or quantified post-quantum security claim.

## Before real funds

External cryptographic assessment and program audit, remediation, adversarial testing, a durable signer-state architecture, rollback analysis, independently reproducible deployed binary, published upgrade policy and an operational incident owner are required. See the release checklist. Public source alone does not satisfy any of those requirements.
