import { boundedText } from "@/lib/bounded-body";
import { PAYMENT_WALLET } from "@/lib/bounty";
import { getConfig } from "@/lib/bunker-config";
import { getLaunch } from "@/lib/launch-config";
import {
  balanceOfCall,
  ETH_DECIMALS,
  ETHEREUM_CHAIN_ID,
  exactUnits,
  paymentLabelsFrom,
  quantity,
  type Receipt,
  USDT_CONTRACT,
  USDT_DECIMALS,
  usdtPaid,
} from "@/lib/payment-wallet";
import checkedIn from "@/lib/payment-labels.json";
import { clientOf, rateLimiter } from "@/lib/rate-limit";

/** What the payment wallet holds on Ethereum, read from an Ethereum node and
 * remembered for a minute. The answer counts only if the node says it is
 * Ethereum mainnet; anything unexpected is a failure, never a zero. */
type Payment = { hash: string; time: number; usdt: string; to: string; label: string };
type Holdings = { address: string; usdt: string; eth: string; payments: Payment[] };
/** Payments are named in git by transaction hash; what each one paid, to whom
 * and when is read from Ethereum, so a label cannot carry a number. */
const labels = Object.entries(paymentLabelsFrom(checkedIn));
if (labels.length > 20) throw new Error("Too many labeled payments to read on every request");
const REMEMBER_MS = 60_000;
let remembered: { at: number; holdings: Promise<Holdings> } | null = null;
const allow = rateLimiter(60, 60_000);

function rpcUrl() {
  // An empty setting is an unset one, not an address.
  const url = process.env.ETHEREUM_RPC_URL || "https://ethereum.publicnode.com";
  if (new URL(url).protocol !== "https:") throw new Error("Remote RPC must use HTTPS");
  return url;
}
async function ask(method: string, params: unknown[], limit = 4096): Promise<unknown> {
  const r = await fetch(rpcUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(10000),
    redirect: "error",
  });
  if (!r.ok) throw new Error("RPC unavailable");
  return (JSON.parse(await boundedText(r.body, limit)) as { result?: unknown }).result;
}
async function payment(hash: string, label: string): Promise<Payment> {
  const receipt = (await ask("eth_getTransactionReceipt", [hash], 400_000)) as Receipt | null;
  if (!receipt) throw new Error("No receipt");
  const { amount, to } = usdtPaid(receipt, PAYMENT_WALLET);
  // false: the block's header and transaction hashes, not every transaction in full.
  const block = (await ask("eth_getBlockByNumber", [receipt.blockNumber, false], 400_000)) as { timestamp?: unknown } | null;
  return { hash, time: Number(quantity(block?.timestamp)), usdt: exactUnits(amount, USDT_DECIMALS), to, label };
}
async function read(): Promise<Holdings> {
  const [chain, eth, usdt, payments] = await Promise.all([
    ask("eth_chainId", []),
    ask("eth_getBalance", [PAYMENT_WALLET, "latest"]),
    ask("eth_call", [{ to: USDT_CONTRACT, data: balanceOfCall(PAYMENT_WALLET) }, "latest"]),
    Promise.all(labels.map(([hash, label]) => payment(hash, label))),
  ]);
  if (chain !== ETHEREUM_CHAIN_ID) throw new Error("Network mismatch");
  return {
    address: PAYMENT_WALLET,
    usdt: exactUnits(quantity(usdt), USDT_DECIMALS),
    eth: exactUnits(quantity(eth), ETH_DECIMALS),
    payments: payments.sort((a, b) => b.time - a.time),
  };
}
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!allow(clientOf(request)))
    return new Response("Too many requests", { status: 429, headers: { ...headers, "Retry-After": "30" } });
  // Shown with the vault and never before it.
  if (!getLaunch().bountyWallet || getConfig().network !== "mainnet-beta")
    return Response.json({ error: "The bounty vault has not been published." }, { status: 404, headers });
  const now = Date.now();
  if (!remembered || now - remembered.at >= REMEMBER_MS) {
    const entry = { at: now, holdings: read() };
    remembered = entry;
    // A failed read is not remembered: the next request asks again.
    entry.holdings.catch(() => remembered === entry && (remembered = null));
  }
  try {
    return Response.json(await remembered.holdings, { headers });
  } catch {
    return Response.json({ error: "Ethereum could not be read just now." }, { status: 503, headers });
  }
}
