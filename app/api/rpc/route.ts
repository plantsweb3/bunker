import { getConfig, getRpcUrl, MAINNET_GENESIS } from "@/lib/bunker-config";
import { boundedText, BodyLimitError } from "@/lib/bounded-body";
import { clientOf, rateLimiter } from "@/lib/rate-limit";
const allow = rateLimiter(300, 60_000);
/** The largest answer passed back. Bounds how much one small request can pull. */
const MAX_RESPONSE_BYTES = 1_500_000;
/** Keeps list-shaped reads small. Returns false for a request that asks for
 * more than this site ever needs. */
function bounded(method: string, params: unknown[]): boolean {
  const options = (i: number) =>
    params[i] && typeof params[i] === "object" ? (params[i] as Record<string, unknown>) : null;
  if (method === "getMultipleAccounts")
    return Array.isArray(params[0]) && params[0].length <= 100;
  if (method === "getSignatureStatuses")
    return Array.isArray(params[0]) && params[0].length <= 32;
  if (method === "getSignaturesForAddress") {
    const o = options(1);
    return !!o && typeof o.limit === "number" && o.limit >= 1 && o.limit <= 25;
  }
  return true;
}
const reads = new Set([
  "getGenesisHash",
  "getVersion",
  "getSlot",
  "getBlockHeight",
  "getLatestBlockhash",
  "getBalance",
  "getAccountInfo",
  "getMultipleAccounts",
  "getTokenAccountsByOwner",
  "getMinimumBalanceForRentExemption",
  "getSignatureStatuses",
  "getSignaturesForAddress",
  "getTransaction",
  "getFeeForMessage",
]);
export async function POST(request: Request) {
  const h = { "Cache-Control": "no-store" };
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 18000)
      return new Response("Request too large", { status: 413 });
    let body;
    try {
      body = JSON.parse(await boundedText(request.body, 18000));
    } catch (e) {
      return new Response("Invalid or oversized RPC request", {
        status: e instanceof BodyLimitError ? 413 : 400,
      });
    }
    if (
      Array.isArray(body) ||
      !body ||
      body.jsonrpc !== "2.0" ||
      typeof body.method !== "string" ||
      !Array.isArray(body.params ?? [])
    )
      return new Response("Invalid RPC request", { status: 400 });
    if (!allow(clientOf(request)))
      return new Response("Too many requests", {
        status: 429,
        headers: { ...h, "Retry-After": "30" },
      });
    if (!bounded(body.method, body.params ?? []))
      return new Response("Request asks for too much", { status: 400 });
    const c = getConfig();
    if (
      !reads.has(body.method) &&
      !(
        c.custodyEnabled &&
        ["simulateTransaction", "sendTransaction"].includes(body.method)
      )
    )
      return Response.json(
        {
          jsonrpc: "2.0",
          id: body.id,
          error: {
            code: -32601,
            message: "This operation is unavailable in the current release.",
          },
        },
        { headers: h },
      );
    const origin = request.headers.get("origin");
    // Next's internal URL can use localhost while the browser addresses 127.0.0.1.
    // Browsers cannot set Host; compare Origin with the incoming authority and
    // request scheme. Do not trust arbitrary forwarded-host headers. This is
    // browser-origin filtering, never authentication or the custody release gate.
    const requestUrl = new URL(request.url);
    const incomingHost = request.headers.get("host") ?? requestUrl.host;
    const incomingUrl = new URL(`${requestUrl.protocol}//${incomingHost}`);
    if (
      incomingUrl.host !== incomingHost ||
      incomingUrl.username ||
      incomingUrl.password ||
      (origin && origin !== incomingUrl.origin)
    )
      return new Response("Origin not allowed", { status: 403 });
    if (c.custodyEnabled && !c.expectedGenesis)
      return new Response("Test network has no pinned genesis hash", {
        status: 503,
      });
    if (["simulateTransaction", "sendTransaction"].includes(body.method)) {
      const check = await fetch(getRpcUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getGenesisHash",
        }),
        signal: AbortSignal.timeout(10000),
        redirect: "error",
      });
      const genesis = JSON.parse(await boundedText(check.body, 4096)) as {
        result?: string;
      };
      if (
        !check.ok ||
        genesis.result !== c.expectedGenesis ||
        genesis.result === MAINNET_GENESIS
      )
        return new Response("Network mismatch: transaction blocked", {
          status: 403,
        });
    }
    const r = await fetch(getRpcUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(18000),
      redirect: "error",
    });
    if (!r.ok)
      return Response.json(
        {
          jsonrpc: "2.0",
          id: body.id,
          error: {
            code: -32000,
            message:
              "RPC unavailable or rate limited. Configure a production Solana RPC endpoint.",
          },
        },
        { status: 503, headers: h },
      );
    let result;
    try {
      result = await boundedText(r.body, MAX_RESPONSE_BYTES);
    } catch (e) {
      if (e instanceof BodyLimitError)
        return new Response("RPC response too large", { status: 502 });
      throw e;
    }
    return new Response(result, {
      headers: { ...h, "Content-Type": "application/json" },
    });
  } catch {
    return Response.json(
      {
        error:
          "Solana connection unavailable. Try again or configure a dedicated RPC endpoint.",
      },
      { status: 503, headers: h },
    );
  }
}
