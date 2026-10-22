/** Whether the Bunker program can still be changed, read from the chain.
 *
 * A program under the upgradeable loader points to a program-data account;
 * that account's header says who may replace the code, or that nobody can.
 * Only the 45-byte header is fetched, never the code. */
import { type Connection, PublicKey } from "@solana/web3.js";

export const UPGRADEABLE_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
const PROGRAM_VARIANT = 2;
const PROGRAM_DATA_VARIANT = 3;
const HEADER = 45;
export type ProgramStatus = { authority: string | null };

const u32 = (d: Uint8Array) => new DataView(d.buffer, d.byteOffset, d.byteLength).getUint32(0, true);
/** The program-data address a program account names. */
export function programDataOf(owner: string, data: Uint8Array): PublicKey {
  if (owner !== UPGRADEABLE_LOADER || data.length < 36 || u32(data) !== PROGRAM_VARIANT)
    throw new Error("Not a program of the upgradeable loader");
  return new PublicKey(data.subarray(4, 36));
}
/** Who may upgrade, from a program-data header: an address, or null for nobody. */
export function authorityOf(owner: string, header: Uint8Array): string | null {
  if (owner !== UPGRADEABLE_LOADER || header.length < HEADER || u32(header) !== PROGRAM_DATA_VARIANT)
    throw new Error("Not a program-data account of the upgradeable loader");
  if (header[12] > 1) throw new Error("Unreadable upgrade authority");
  return header[12] === 1 ? new PublicKey(header.subarray(13, HEADER)).toBase58() : null;
}
export async function readProgramStatus(c: Connection, program: string): Promise<ProgramStatus> {
  const account = await c.getAccountInfo(new PublicKey(program));
  if (!account) throw new Error("No Bunker found at the program address");
  const address = programDataOf(account.owner.toBase58(), account.data);
  const data = await c.getAccountInfo(address, { dataSlice: { offset: 0, length: HEADER } });
  if (!data) throw new Error("The program's data account is missing");
  return { authority: authorityOf(data.owner.toBase58(), data.data) };
}
