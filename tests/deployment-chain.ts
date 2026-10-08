// The deployment check against a real deployment on the ISOLATED local
// validator: a program deployed upgradeable, then made final, and one deployed
// final from the start. Needs the validator running and the `solana` CLI.
//   npx tsx tests/deployment-chain.ts
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { checkDeployment } from "../scripts/check-deployment";

const RPC = process.env.BUNKER_LOCAL_RPC ?? "http://127.0.0.1:19099";
const BINARY = "target/deploy/bunker3.so";
const check = (ok: boolean, what: string) => {
  if (!ok) throw new Error(`FAILED: ${what}`);
};
const c = new Connection(RPC, "confirmed");
const dir = mkdtempSync(join(tmpdir(), "bunker-deploy-"));
const keyFile = (name: string, k: Keypair) => {
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(Array.from(k.secretKey)));
  return path;
};
const solana = (...args: string[]) => {
  const r = spawnSync("solana", [...args, "--url", RPC, "--commitment", "confirmed"], { encoding: "utf8", timeout: 180_000 });
  if (r.status !== 0) throw new Error(`solana ${args.join(" ")}\n${r.stdout}${r.stderr}`);
  return r.stdout;
};
const script = (program: PublicKey, binary: string) =>
  spawnSync(
    "npx",
    ["tsx", "scripts/check-deployment.ts", "--rpc", RPC, "--program", program.toBase58(), "--binary", binary, "--commitment", "confirmed"],
    { encoding: "utf8", timeout: 90_000 },
  );

async function main() {
  const genesis = await c.getGenesisHash();
  check(genesis !== "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d", "this test never runs against mainnet");
  const binary = readFileSync(BINARY);
  const payer = Keypair.generate();
  const payerFile = keyFile("payer", payer);
  await c.confirmTransaction(await c.requestAirdrop(payer.publicKey, 20 * LAMPORTS_PER_SOL), "confirmed");

  // Deployed the ordinary way: the code matches, and it can still be replaced.
  const upgradeable = Keypair.generate();
  solana("program", "deploy", BINARY, "--program-id", keyFile("upgradeable", upgradeable), "--keypair", payerFile);
  let r = await checkDeployment(c, upgradeable.publicKey, binary, "confirmed");
  check(r.codeMatches && !r.immutable && r.upgradeAuthority === payer.publicKey.toBase58(), "an upgradeable deployment is reported as replaceable by its authority");
  check(r.genesis === genesis && r.binarySha256 === r.onChainSha256, "the report names the chain and both hashes");
  let ran = script(upgradeable.publicKey, BINARY);
  check(ran.status === 1 && ran.stdout.includes("Upgrades: POSSIBLE"), `the command fails while upgrades are possible: ${ran.stdout}${ran.stderr}`);

  // A different binary does not match, by one byte.
  const altered = Uint8Array.from(binary);
  altered[altered.length >> 1] ^= 1;
  check(!(await checkDeployment(c, upgradeable.publicKey, altered, "confirmed")).codeMatches, "another binary does not match");
  const alteredFile = join(dir, "altered.so");
  writeFileSync(alteredFile, altered);

  // The authority removed: the same program is now final.
  solana("program", "set-upgrade-authority", upgradeable.publicKey.toBase58(), "--final", "--keypair", payerFile);
  r = await checkDeployment(c, upgradeable.publicKey, binary, "confirmed");
  check(r.codeMatches && r.immutable && r.upgradeAuthority === null, "after the authority is removed the program is reported immutable");
  ran = script(upgradeable.publicKey, BINARY);
  check(ran.status === 0 && ran.stdout.includes("Upgrades: impossible") && ran.stdout.includes("Code: matches"), `the command passes: ${ran.stdout}${ran.stderr}`);
  ran = script(upgradeable.publicKey, alteredFile);
  check(ran.status === 1 && ran.stdout.includes("DOES NOT MATCH"), "the command fails for another binary even when the program is final");

  // Deployed final from the start, as the launch runbook does it.
  const final = Keypair.generate();
  solana("program", "deploy", BINARY, "--program-id", keyFile("final", final), "--keypair", payerFile, "--final");
  r = await checkDeployment(c, final.publicKey, binary, "confirmed");
  check(r.codeMatches && r.immutable, "a program deployed with --final is immutable from its first slot");

  // Things that are not a program of the upgradeable loader.
  for (const [what, address] of [["a wallet", payer.publicKey], ["nothing", Keypair.generate().publicKey], ["a native program", new PublicKey("11111111111111111111111111111111")]] as const) {
    let refused = false;
    await checkDeployment(c, address, binary, "confirmed").catch(() => (refused = true));
    check(refused, `${what} is refused`);
  }
  console.log(JSON.stringify({ deploymentCheck: "ok", network: "isolated local validator", genesis }, null, 2));
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
