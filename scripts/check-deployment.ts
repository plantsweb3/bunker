// Checks a deployed Bunker program against a build, from public data alone.
//
//   npm run check:deployment -- --rpc URL --program ADDRESS --binary target/deploy/bunker3.so
//
// It reads the program from the network and reports three things:
//   1. the code on-chain is byte for byte the given binary;
//   2. the program can never be changed (its upgrade authority is gone);
//   3. the chain the endpoint serves (its genesis hash).
// It exits non-zero unless 1 and 2 both hold. It needs no key and sends
// nothing. Anyone can run it; nobody has to take the project's word for
// either answer. This is NOT an audit of what the code does.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Commitment, Connection, PublicKey } from "@solana/web3.js";

export const UPGRADEABLE_LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
/** `UpgradeableLoaderState::Program`: variant 2, then the program-data address. */
const PROGRAM_VARIANT = 2;
/** `UpgradeableLoaderState::ProgramData`: variant 3, deployment slot, an
 * optional upgrade authority, then the code. The header is 45 bytes whether or
 * not an authority is present. */
const PROGRAM_DATA_VARIANT = 3;
const PROGRAM_DATA_HEADER = 4 + 8 + 1 + 32;

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
/** A program account is allocated larger than its code and padded with zeros,
 * so code is compared without trailing zero bytes on either side. */
export function trimmed(code: Uint8Array): Uint8Array {
  let end = code.length;
  while (end > 0 && code[end - 1] === 0) end--;
  return code.subarray(0, end);
}
export type ProgramData = { slot: bigint; authority: PublicKey | null; code: Uint8Array };
/** The program-data address a program account points to. */
export function programDataAddress(owner: PublicKey, data: Uint8Array): PublicKey {
  if (!owner.equals(UPGRADEABLE_LOADER))
    throw new Error(`The program is owned by ${owner.toBase58()}, not the upgradeable loader; this check does not cover it`);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length !== 36 || view.getUint32(0, true) !== PROGRAM_VARIANT)
    throw new Error("Not a program account of the upgradeable loader");
  return new PublicKey(data.subarray(4, 36));
}
export function parseProgramData(owner: PublicKey, data: Uint8Array): ProgramData {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (!owner.equals(UPGRADEABLE_LOADER) || data.length < PROGRAM_DATA_HEADER || view.getUint32(0, true) !== PROGRAM_DATA_VARIANT)
    throw new Error("Not a program-data account of the upgradeable loader");
  const tag = data[12];
  if (tag > 1) throw new Error("Unreadable upgrade authority");
  return {
    slot: view.getBigUint64(4, true),
    authority: tag === 1 ? new PublicKey(data.subarray(13, 45)) : null,
    code: data.subarray(PROGRAM_DATA_HEADER),
  };
}
export type Report = {
  genesis: string;
  program: string;
  programData: string;
  deployedSlot: string;
  upgradeAuthority: string | null;
  onChainSha256: string;
  binarySha256: string;
  binaryFileSha256: string;
  codeMatches: boolean;
  immutable: boolean;
};
/** Reads at `finalized` unless told otherwise, so the answer cannot be rolled back. */
export async function checkDeployment(
  connection: Connection,
  program: PublicKey,
  binary: Uint8Array,
  commitment: Commitment = "finalized",
): Promise<Report> {
  const account = await connection.getAccountInfo(program, commitment);
  if (!account) throw new Error("No account at that address on this network");
  if (!account.executable) throw new Error("That account is not a program");
  const dataAddress = programDataAddress(account.owner, account.data);
  const expected = PublicKey.findProgramAddressSync([program.toBytes()], UPGRADEABLE_LOADER)[0];
  if (!dataAddress.equals(expected)) throw new Error("The program points at an unexpected program-data account");
  const dataAccount = await connection.getAccountInfo(dataAddress, commitment);
  if (!dataAccount) throw new Error("The program's code account is missing");
  const data = parseProgramData(dataAccount.owner, dataAccount.data);
  const onChain = sha256(trimmed(data.code));
  const local = sha256(trimmed(binary));
  return {
    genesis: await connection.getGenesisHash(),
    program: program.toBase58(),
    programData: dataAddress.toBase58(),
    deployedSlot: data.slot.toString(),
    upgradeAuthority: data.authority?.toBase58() ?? null,
    onChainSha256: onChain,
    binarySha256: local,
    binaryFileSha256: sha256(binary),
    codeMatches: onChain === local,
    immutable: data.authority === null,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(`--${name}`);
    if (i < 0 || !args[i + 1]) throw new Error(`Missing --${name}`);
    return args[i + 1];
  };
  // `--commitment confirmed` exists for tests; leave it out for a real check.
  const commitment = args.includes("--commitment") ? (flag("commitment") as Commitment) : "finalized";
  const report = await checkDeployment(
    new Connection(flag("rpc"), commitment),
    new PublicKey(flag("program")),
    readFileSync(flag("binary")),
    commitment,
  );
  console.log(JSON.stringify(report, null, 2));
  console.log(report.codeMatches ? "Code: matches the binary." : "Code: DOES NOT MATCH the binary.");
  console.log(
    report.immutable
      ? "Upgrades: impossible. The upgrade authority has been removed."
      : `Upgrades: POSSIBLE. ${report.upgradeAuthority} can replace this program.`,
  );
  if (!report.codeMatches || !report.immutable) process.exit(1);
}
if (process.argv[1]?.endsWith("check-deployment.ts"))
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
