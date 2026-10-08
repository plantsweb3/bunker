#!/usr/bin/env bash
# Runs everything docs/TESTING.md describes, in order, on an ISOLATED local
# validator it starts and stops itself. One command for a reviewer:
#
#   npm ci && ./scripts/full-check.sh
#
# Needs Node 22, Rust, the Solana CLI with cargo-build-sbf, and Playwright's
# browsers (npx playwright install chromium). Uses ports 5173, 19099 and 19900.
# Takes about fifteen minutes. Stops at the first failure.
set -euo pipefail
cd "$(dirname "$0")/.."
work="$(mktemp -d)"
step() { printf '\n== %s\n' "$1"; }
cleanup() {
  [ -n "${server_pid:-}" ] && kill "$server_pid" 2>/dev/null || true
  [ -n "${validator_pid:-}" ] && kill "$validator_pid" 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT
for port in 5173 19099 19900; do
  if lsof -ti:"$port" >/dev/null 2>&1; then
    echo "Port $port is in use. Stop whatever is using it and run this again." >&2
    exit 1
  fi
done

step "Lint and types";            npm run lint && npm run typecheck
step "Unit tests";                npm test
step "Independent implementation"; python3 scripts/independent-check.py
step "Rust workspace";            cargo test --workspace --locked
step "Build the program";         npm run program:build && shasum -a 256 target/deploy/bunker3.so
step "Compiled program in a VM";  (cd programs/bunker3-svm-tests && cargo test --locked)
step "Client vectors reproduce";  npx tsx scripts/v3-vectors.ts | diff - fixtures/bunker-v3.json

step "Start an isolated local validator"
BUNKER_LOCAL_LEDGER="$work/ledger" ./scripts/local-validator.sh > "$work/validator.log" 2>&1 &
validator_pid=$!
for _ in $(seq 1 90); do
  curl -s http://127.0.0.1:19099 -X POST -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' | grep -q '"ok"' && break
  sleep 1
done

step "Offline tool and command-line client build reproducibly"
npm run source:bundle
cp public/source/bunker-recovery-tool.html "$work/tool.html"
cp public/source/bunker-cli.mjs "$work/cli.mjs"
npm run tool:build && npm run cli:build
cmp "$work/tool.html" public/source/bunker-recovery-tool.html
cmp "$work/cli.mjs" public/source/bunker-cli.mjs

# The site is built in its released, read-only configuration. The browser
# tests point their own pages at the local validator; nothing here enables
# custody in the build.
step "Build and start the site"
npm run build > "$work/build.log" 2>&1 || { tail -30 "$work/build.log"; exit 1; }
npm start > "$work/server.log" 2>&1 &
server_pid=$!
for _ in $(seq 1 60); do curl -fsS http://127.0.0.1:5173/ >/dev/null 2>&1 && break; sleep 1; done

step "Browser, desktop and mobile";        npm run test:e2e
step "Chain cycles";                       npm run test:chain
step "Alerts";                             npm run test:alerts
step "Command-line client, from source";   npm run test:cli
step "Command-line client, single file";   BUNKER_CLI=public/source/bunker-cli.mjs npm run test:cli
step "Deployment check";                   npm run test:deploy
printf '\nAll checks passed.\n'
