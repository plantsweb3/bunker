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
/** The event a token contract records for every transfer. */
export const TRANSFER_EVENT = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export const ETHEREUM_HASH = /^0x[0-9a-f]{64}$/;
export type PaymentLabels = Record<string, string>;
/** The checked-in labels for payments made on Ethereum, refused whole if any
 * entry is not a transaction hash with a short plain label. */
export function paymentLabelsFrom(json: unknown): PaymentLabels {
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("Labels must be an object");
  for (const [hash, label] of Object.entries(json)) {
    if (!ETHEREUM_HASH.test(hash)) throw new Error(`Not a transaction hash: ${hash}`);
    if (typeof label !== "string" || !/^[A-Za-z0-9 ]{1,40}$/.test(label)) throw new Error(`Not a label: ${hash}`);
  }
  return json as PaymentLabels;
}
/** `eth_getTransactionReceipt`, as far as this file reads it. */
export type Receipt = {
  status?: string;
  blockNumber?: string;
  logs?: { address?: string; topics?: string[]; data?: string }[];
};
const word = (address: string) => "0x" + address.slice(2).toLowerCase().padStart(64, "0");
/** The USDT one transaction moved out of `holder`, and to whom, read from the
 * transfer records in its receipt. A label is only ever a name for a payment
 * the chain shows: a transaction that failed, moved nothing out of the
 * holder, or paid more than one address is refused, not described. */
export function usdtPaid(receipt: Receipt, holder: string): { amount: bigint; to: string } {
  if (receipt?.status !== "0x1" || !Array.isArray(receipt.logs)) throw new Error("Transaction did not succeed");
  let amount = 0n;
  let to: string | null = null;
  for (const log of receipt.logs) {
    if (log.address?.toLowerCase() !== USDT_CONTRACT.toLowerCase()) continue;
    const topics = log.topics ?? [];
    if (topics.length !== 3 || topics[0] !== TRANSFER_EVENT || topics[1] !== word(holder)) continue;
    const receiver = "0x" + topics[2].slice(26);
    if (to !== null && to !== receiver) throw new Error("More than one receiver");
    to = receiver;
    amount += quantity(log.data);
  }
  if (to === null || amount === 0n) throw new Error("No payment in this transaction");
  return { amount, to };
}
