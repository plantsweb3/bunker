/** Protocol 3 chain reads (DRAFT). Uses only RPC methods already on the
 * read allowlist. */
import { Connection, PublicKey, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import { parseVault, vaultAddress, VAULT_SIZE, VaultState } from "./protocol";
/** Consensus time, the clock the program enforces delays against. */
export async function chainTime(connection: Connection): Promise<bigint> {
  const info = await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY);
  if (!info || info.data.length < 40) throw new Error("Clock unavailable");
  return new DataView(
    info.data.buffer,
    info.data.byteOffset,
    info.data.byteLength,
  ).getBigInt64(32, true);
}
export async function fetchVault(
  connection: Connection,
  program: PublicKey,
  address: PublicKey,
): Promise<{ state: VaultState; lamports: bigint; spendable: bigint }> {
  const [info, rent] = await Promise.all([
    connection.getAccountInfo(address),
    connection.getMinimumBalanceForRentExemption(VAULT_SIZE),
  ]);
  if (!info || !info.owner.equals(program))
    throw new Error("No Bunker found at that address under this program");
  const state = parseVault(info.data);
  if (!vaultAddress(program, state.vaultId).equals(address))
    throw new Error("Vault address does not match its stored identity");
  const lamports = BigInt(info.lamports);
  const spendable = lamports - BigInt(rent);
  return { state, lamports, spendable: spendable > 0n ? spendable : 0n };
}
/** `1d 3h`, `4h 12m`, `9m 30s`. */
export function formatDuration(seconds: bigint): string {
  const s = seconds < 0n ? 0n : seconds;
  const [d, h, m, sec] = [s / 86400n, (s % 86400n) / 3600n, (s % 3600n) / 60n, s % 60n];
  if (d > 0n) return `${d}d ${h}h`;
  if (h > 0n) return `${h}h ${m}m`;
  return `${m}m ${sec.toString().padStart(2, "0")}s`;
}
