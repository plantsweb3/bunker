import { Connection } from "@solana/web3.js";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
const [payer, program] = process.argv.slice(2);
if (!payer || !program || !existsSync(payer) || !existsSync(program))
  throw new Error(
    "Usage: npm run devnet:deploy -- /absolute/devnet-payer.json /absolute/program-keypair.json",
  );
const url = "https://api.devnet.solana.com";
if (
  (await new Connection(url).getGenesisHash()) !==
  "EtWTRABZaYq6iMfeYKouRu166VU2xqa1"
)
  throw new Error("Not devnet");
if (!existsSync("target/deploy/bunker.so"))
  throw new Error("Build the program first");
const result = spawnSync(
  "solana",
  [
    "program",
    "deploy",
    "target/deploy/bunker.so",
    "--url",
    url,
    "--keypair",
    payer,
    "--program-id",
    program,
  ],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
