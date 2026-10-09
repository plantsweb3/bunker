# Contributing

Bunker is an open-source project in public beta on Solana mainnet. Nothing here has been independently audited, and it holds real funds.

## Security issues

Do not open a public issue or pull request for a vulnerability. Follow [SECURITY.md](SECURITY.md).

## Before you send a change

Read [docs/REVIEWER-GUIDE.md](docs/REVIEWER-GUIDE.md) and, for anything touching the program, the client in `sdk/v3` or the offline tool, [docs/PROTOCOL.md](docs/PROTOCOL.md) and [docs/INTERNAL-REVIEW.md](docs/INTERNAL-REVIEW.md).

Every change must keep these true:

- No environment setting can point the software at a mainnet program other than the published one.
- No claim of an audit, a mainnet deployment or a security level that has not been established and evidenced.
- No key file, wallet keypair, credential or environment file is committed. Check `git status` before `git add`.
- A change to behaviour comes with a test that fails without it. A fix for a flaw comes with a test that reproduces the flaw.
- A change to the program or to anything that is signed updates `docs/PROTOCOL.md` in the same pull request.

## Checks

```sh
npm run typecheck && npm run lint && npm test
cargo test --workspace --locked
npm run program:build
(cd programs/bunker3-svm-tests && cargo test --locked)
```

[docs/TESTING.md](docs/TESTING.md) describes the suites that need a local validator.

## Scope

The program deliberately does very little. Proposals that add instructions, administrators, fees, calls to other programs or new asset types need a written design and a threat-model update before any code.
