// Bunker without the website (DRAFT, test networks only).
//
// From a checkout: `npx tsx tools/cli/bunker.ts <command> ...`. As the single
// file built by scripts/build-cli.mjs, which needs only Node:
// `node bunker-cli.mjs <command> ...`. Run it with no command for the list.
//
// The day key's password is asked for and never taken from the command line.
// The fee wallet is an ordinary Solana keypair file; it pays fees and has no
// authority over a Bunker. The recovery kit is never used here.
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { fetchVault } from "../../sdk/v3/chain";
import { parseRecoveryFile } from "../../sdk/v3/requests";
import { refusalText } from "../../sdk/v3/refusals";
import {
  clearExpired,
  describe,
  openDayKey,
  readBunker,
  readFeeWallet,
  release,
  resume,
  review,
  sessionFor,
  submitRecovery,
  withdraw,
} from "./lib";

const [command, ...rest] = process.argv.slice(2);
const flags = new Map<string, string>();
for (let i = 0; i < rest.length; i += 2) {
  if (!rest[i]?.startsWith("--") || rest[i + 1] === undefined) fail(`Unexpected argument: ${rest[i]}`);
  flags.set(rest[i].slice(2), rest[i + 1]);
}
function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
const need = (name: string) => flags.get(name) ?? fail(`Missing --${name}`);
// One reader for the whole run, so answers typed (or piped) ahead are not lost.
let muted = false;
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
const reader = rl as unknown as { _writeToOutput?: (s: string) => void };
const echo = reader._writeToOutput?.bind(rl);
if (echo) reader._writeToOutput = (s: string) => echo(muted ? "" : s);
const lines: string[] = [];
const waiting: ((line: string) => void)[] = [];
rl.on("line", (line) => (waiting.length ? waiting.shift()!(line) : lines.push(line)));
rl.on("close", () => waiting.splice(0).forEach((w) => w("")));
/** Asks a question. With `hidden`, what is typed is not shown. */
async function ask(question: string, hidden = false): Promise<string> {
  process.stdout.write(question);
  muted = hidden;
  const answer = lines.length ? lines.shift()! : await new Promise<string>((done) => waiting.push(done));
  muted = false;
  if (hidden) process.stdout.write("\n");
  return answer;
}
const COMMANDS = ["status", "withdraw", "resume", "release", "clear", "recover"];
const USAGE = `Bunker without the website. DRAFT: test networks only.

  status    --rpc URL --vault ADDRESS --program ID
            Show a Bunker. Needs no key.
  withdraw  --rpc URL --day-key FILE --fee-wallet FILE --to ADDRESS --amount 1.5 [--mint MINT]
            Review, then sign and send a withdrawal.
  resume    --rpc URL --day-key FILE --fee-wallet FILE
            Finish a withdrawal that was signed but did not reach the network.
  release   --rpc URL --day-key FILE --fee-wallet FILE
            Release an announced withdrawal once its wait is over.
  clear     --rpc URL --day-key FILE --fee-wallet FILE
            Clear an announced withdrawal whose time to be released has passed.
  recover   --rpc URL --packet FILE --fee-wallet FILE
            Submit a recovery packet made by the offline recovery tool.

URL is a Solana RPC endpoint. The day key's password is asked for, never
passed on the command line. The fee wallet is an ordinary Solana keypair
file: it pays network fees and has no power over a Bunker. The recovery
kit is never used here.`;

async function main() {
  if (command === undefined || command === "help" || command === "--help") {
    console.log(USAGE);
    process.exit(command === undefined ? 1 : 0);
  }
  if (!COMMANDS.includes(command)) fail(`Unknown command "${command}".\n\n${USAGE}`);
  if (command === "status") {
    // Read-only, so it needs no key file and no fee wallet.
    const connection = new Connection(need("rpc"), "confirmed");
    const program = new PublicKey(need("program"));
    const vault = new PublicKey(need("vault"));
    const s = { connection, program } as Parameters<typeof readBunker>[0];
    await fetchVault(connection, program, vault);
    for (const line of describe(vault.toBase58(), await readBunker(s, vault))) console.log(line);
    return;
  }
  const payer: Keypair = readFeeWallet(need("fee-wallet"));
  if (command === "recover") {
    const file = parseRecoveryFile(readFileSync(need("packet"), "utf8"));
    console.log(await submitRecovery(sessionFor(file, need("rpc"), payer), need("packet")));
    return;
  }
  const path = need("day-key");
  const day = await openDayKey(path, await ask("Day key password: ", true));
  const s = sessionFor(day, need("rpc"), payer);
  const vault = new PublicKey(day.vault);
  if (command === "release") return console.log(await release(s, vault));
  if (command === "clear") return console.log(await clearExpired(s, vault));
  if (command === "resume") return console.log(await resume(s, day, path));
  const reviewed = await review(s, day, { to: need("to"), amount: need("amount"), mint: flags.get("mint") });
  console.log("");
  for (const line of reviewed.lines) console.log(`  ${line}`);
  console.log("");
  console.log("Signing uses up a one-time key. After this it cannot be changed, only finished or cancelled by recovery.");
  if ((await ask('Type "sign" to sign and send exactly this: ')) !== "sign") fail("Nothing was signed.");
  console.log(await withdraw(s, day, path, reviewed));
}
main()
  .then(() => rl.close())
  .catch((e) => {
    const message = e instanceof Error ? e.message : "Failed";
    fail(refusalText(message) ?? message);
  });
