#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
ledger="${BUNKER_LOCAL_LEDGER:-.local-validator}"
if [[ ! -f target/deploy/bunker.so ]]; then
  cargo-build-sbf --manifest-path programs/bunker/Cargo.toml --sbf-out-dir target/deploy
fi
exec solana-test-validator --ledger "$ledger" --rpc-port 19099 --faucet-port 19900 --gossip-port 19102 --dynamic-port-range 19110-19160 --bind-address 127.0.0.1 --bpf-program AhZPKQAwKeCJ47PVKz5QZmBwf1PE8BHcmcqsjvSdPaZ target/deploy/bunker.so
