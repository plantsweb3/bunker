import { getConfig, getRpcUrl, MAINNET_GENESIS } from "@/lib/bunker-config";
import { boundedText, BodyLimitError } from "@/lib/bounded-body";
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
      return new Response("Invalid or oversized RPC request", { status: e instanceof BodyLimitError ? 413 : 400 });
    }
    if (
      Array.isArray(body) ||
      !body ||
      body.jsonrpc !== "2.0" ||
      typeof body.method !== "string" ||
      !Array.isArray(body.params ?? [])
    )
      return new Response("Invalid RPC request", { status: 400 });
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
    if (origin && origin !== new URL(request.url).origin)
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
      const genesis = JSON.parse(await boundedText(check.body, 4096)) as { result?: string };
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
      result = await boundedText(r.body, 3000000);
    } catch (e) {
      if (e instanceof BodyLimitError) return new Response("RPC response too large", { status: 502 });
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
