/** Reading the payment wallet's balances on Ethereum. Amounts stay whole
 * numbers of the smallest unit until they are printed, and are printed in
 * full: nothing here rounds. No imports, so the tests and the route share it. */
export const ETHEREUM_CHAIN_ID = "0x1";
/** Tether's USDT contract on Ethereum mainnet. It counts in millionths. */
export const USDT_CONTRACT = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
export const USDT_DECIMALS = 6;
export const ETH_DECIMALS = 18;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
/** The call that asks a token contract for one address's balance. */
export function balanceOfCall(holder: string): string {
  if (!ADDRESS.test(holder)) throw new Error("Not an Ethereum address");
  return "0x70a08231" + holder.slice(2).toLowerCase().padStart(64, "0");
}
/** A number as an Ethereum node writes it. Anything else is refused. */
export function quantity(hex: unknown): bigint {
  if (typeof hex !== "string" || !/^0x[0-9a-f]{1,64}$/i.test(hex)) throw new Error("Not a quantity");
  return BigInt(hex);
}
/** Every digit, with no rounding: 6010010694 in millionths is "6010.010694". */
export function exactUnits(amount: bigint, decimals: number): string {
  if (amount < 0n) throw new Error("Not an amount");
  const digits = amount.toString().padStart(decimals + 1, "0");
  const rest = digits.slice(-decimals).replace(/0+$/, "");
  const whole = digits.slice(0, -decimals);
  return rest ? `${whole}.${rest}` : whole;
}
