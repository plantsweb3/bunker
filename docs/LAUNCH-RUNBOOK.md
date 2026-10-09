# Launch runbook: from a reviewed release to real funds

**Status: superseded in part.** This was written as the plan for an audited, immutable launch. On 2026-10-09 the program was instead deployed to mainnet as an unaudited public beta, upgradeable, without the preconditions in step 0; [DEPLOYMENT.md](DEPLOYMENT.md) records what was done. Steps 2, 4, 6 and 7 still describe how the build is reproduced, how the deployment is checked and what to do if something is wrong. This is the order of work for the day those things change, written in advance so that it can be reviewed too.

Every step names what is produced and what is published. A step is done when its output exists and someone other than the person who did it has checked it.

## 0. Preconditions

None of these can be done from this repository.

- [ ] An independent cryptographic review of `docs/CRYPTOGRAPHY.md` and `docs/PROTOCOL.md` §1, with its report public.
- [ ] An independent audit of the program and client on a frozen tag, with its report public and every finding resolved or accepted in writing.
- [ ] `docs/REVIEW-CHECKLIST.md` complete.
- [ ] Legal review of `/terms` and `/privacy`.
- [ ] The whole flow run on real phones and in wallet apps' browsers, with what does not work there stated on the site.
- [ ] A named person responsible for incidents, and a disclosure address that is read.
- [ ] A dedicated RPC provider with spending limits, and an edge rate limit on `/api/rpc`.

## 1. Freeze

1. Tag the audited commit: `git tag -s v1.0.0 <commit>`. The tag must be the commit the audit report names. Nothing is deployed from a branch.
2. From a clean checkout of the tag, run everything in `docs/TESTING.md`, including the validator suites.

Published: the tag, and the audit report naming it.

## 2. Build the program reproducibly

The program must be built in the pinned container, not on a developer machine: a Mac and the CI runner produce different bytes from the same source.

```sh
cargo install solana-verify --locked --version 0.5.2
git clone https://github.com/plantsweb3/bunker && cd bunker && git checkout v1.0.0
solana-verify build --library-name bunker3
solana-verify get-executable-hash target/deploy/bunker3.so
```

`solana-verify` builds inside a container image fixed by digest for the Solana version named in the root `Cargo.toml` (`[workspace.metadata.cli]`). Do this on two machines, by two people if there are two. The hashes must be equal, and equal to the hash the `verified-build` job in CI printed for the tag's commit. That job already builds every commit twice, from two separate checkouts, and fails if the two differ.

The `program-vm` job's binary is a different build (same source, tools installed directly on the runner) and has a different hash. It is the one the tests run against; the container build is the one that is deployed. Before deploying, run the VM suite against the container build as well: copy it to `target/deploy/bunker3.so` and run `cargo test --locked` in `programs/bunker3-svm-tests`.

Published: the hash, and how to reproduce it (these three lines).

## 3. Deploy, immutable

The deployer wallet is a fresh hardware-wallet account funded for this purpose. It gains no authority over any Bunker and is not reused.

```sh
solana-keygen grind --starts-with BNKR:1          # optional: a recognisable program address
solana program deploy target/deploy/bunker3.so \
  --program-id <program-keypair.json> \
  --url mainnet-beta --keypair usb://ledger --final
```

`--final` deploys with no upgrade authority. There is no later step at which it could be forgotten, and no window in which the program is upgradeable. If the deployment is interrupted, recover the buffer (`solana program show --buffers`) and resume; do not deploy without `--final` "to finish quickly".

Then destroy the program keypair file. It has no power once the program exists, but it should not survive to confuse anyone.

Published: the program address and the deployment transaction.

## 4. Check the deployment, from public data

```sh
npm run check:deployment -- --rpc https://api.mainnet-beta.solana.com \
  --program <address> --binary target/deploy/bunker3.so
solana-verify verify-from-repo -u https://api.mainnet-beta.solana.com --program-id <address> \
  https://github.com/plantsweb3/bunker --commit-hash <tag commit> --library-name bunker3
```

The first reads the program from the network and must report that the code matches the binary and that upgrades are impossible; it exits non-zero otherwise (`tests/deployment-chain.ts` exercises it against real deployments on a local validator, upgradeable and final). The second rebuilds from the repository and compares with the chain. Ask at least one person outside the project to run both and say so publicly.

Published: both outputs.

## 5. Point the software at it

This is a source change, reviewed like any other, in one pull request:

- the program address and mainnet genesis hash in the offline tool (it refuses mainnet until it has a pinned program address) and in `lib/bunker-config.ts`;
- the release gate that keeps mainnet custody off. There is deliberately no environment variable for this;
- `/api/verify` and the site's status wording: audited by whom, report link, program address, binary hash, immutability transaction. Remove "unaudited" only where a report now covers the thing described.

Rebuild the offline tool and the command-line client from the merged commit and publish their hashes somewhere other than the website (a signed GitHub release). The tool's users are told to compare.

## 6. First funds

1. The project's own funds first: build a Bunker, deposit a small amount, withdraw to a trusted address, withdraw to an untrusted address and wait, cancel one by recovery, recover with the kit. On mainnet, with the released tool and site, on a phone and a computer.
2. Then a cap. State publicly a maximum the project recommends per Bunker for the first period, and say when it will be revisited.
3. Alerts on. Watch the program's accounts for anything the tests did not predict.

## 7. If something is wrong after launch

The program cannot be paused or changed. That is the design, and it is the cost of nobody being able to change the rules on users.

1. Stop new deposits in the interface and say why, on the site and on the project's account, within the hour.
2. Tell holders to withdraw. The command-line client and the offline tool work without the website; say where to get them and what their hashes are.
3. If the flaw lets a holder of a day key do more than they should, tell holders to recover first (which retires the day key), then withdraw.
4. Publish the finding in full once funds are out, and a successor at a new program address after it has been reviewed. There is no migration: users move by withdrawing.

## What this runbook cannot give

A deployment that matches its source and cannot be changed says nothing about whether the source is right. That rests on the reviews in step 0 and on how many people have read the code.
