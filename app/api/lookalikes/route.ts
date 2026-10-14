import { boundedText } from "@/lib/bounded-body";
import { getConfig, getRpcUrl } from "@/lib/bunker-config";
import { findLookalikes, movementOf, type JsonTransaction, type Movement } from "@/lib/poisoning";
import { clientOf, rateLimiter } from "@/lib/rate-limit";

/** The lookalike check for one wallet: its last transactions read here, on
 * the server, and remembered for five minutes. One check is about a hundred
 * reads, so a browser asks once and the site's RPC quota is spent once per
 * wallet, not once per visitor. */
const DEPTH = 100;
const PAGE = 25;
const AT_ONCE = 4;
const REMEMBER_MS = 5 * 60_000;
const MAX_REMEMBERED = 200;
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** A person checks a few wallets a minute. Each one is a hundred reads. */
const allow = rateLimiter(6, 60_000);
const MAX_RESPONSE_BYTES = 1_500_000;
type Result = {
  found: (Omit<ReturnType<typeof findLookalikes>[number], "received"> & {
    received: { lamports: string } | { mint: string; amount: string };
  })[];
  asked: number;
  read: number;
};
const remembered = new Map<string, { at: number; result: Promise<Result> }>();

async function ask<T>(method: string, params: unknown[]): Promise<T | null> {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(getRpcUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(18000),
      redirect: "error",
    });
    // Asked to slow down: once more after a pause, then give up on this one.
    if (r.status === 429 && attempt === 0) {
      await new Promise((done) => setTimeout(done, 1000));
      continue;
    }
    if (!r.ok) throw new Error("RPC unavailable");
    return ((JSON.parse(await boundedText(r.body, MAX_RESPONSE_BYTES)) as { result?: T }).result ?? null) as T | null;
  }
}
async function check(wallet: string): Promise<Result> {
  const signatures: string[] = [];
  let before: string | undefined;
  while (signatures.length < DEPTH) {
    const page = await ask<{ signature: string }[]>("getSignaturesForAddress", [
      wallet,
      { limit: PAGE, commitment: "confirmed", ...(before ? { before } : {}) },
    ]);
    if (!Array.isArray(page)) throw new Error("Unexpected answer");
    signatures.push(...page.map((s) => s.signature));
    if (page.length < PAGE) break;
    before = page[page.length - 1].signature;
  }
  const wanted = signatures.slice(0, DEPTH);
  const movements: (Movement | null)[] = new Array(wanted.length).fill(null);
  let turn = 0;
  await Promise.all(
    Array.from({ length: Math.min(AT_ONCE, wanted.length) }, async () => {
      for (let i = turn++; i < wanted.length; i = turn++) {
        const tx = await ask<JsonTransaction>("getTransaction", [
          wanted[i],
          { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: 0 },
        ]).catch(() => null);
        movements[i] = movementOf(wanted[i], tx);
      }
    }),
  );
  const read = movements.filter((m) => m !== null);
  return {
    found: findLookalikes(wallet, read).map((f) => ({
      ...f,
      received:
        "lamports" in f.received
          ? { lamports: f.received.lamports.toString() }
          : { mint: f.received.mint, amount: f.received.amount.toString() },
    })),
    asked: wanted.length,
    read: read.length,
  };
}
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const wallet = new URL(request.url).searchParams.get("a") ?? "";
  if (!ADDRESS.test(wallet)) return new Response("Invalid request", { status: 400, headers });
  // History on any other network would be some other wallet's.
  if (getConfig().network !== "mainnet-beta")
    return Response.json({ error: "Only available on mainnet." }, { status: 404, headers });
  const now = Date.now();
  let entry = remembered.get(wallet);
  if (!entry || now - entry.at >= REMEMBER_MS) {
    // Only a check that is not already remembered counts against the limit.
    if (!allow(clientOf(request)))
      return new Response("Too many requests", { status: 429, headers: { ...headers, "Retry-After": "30" } });
    for (const [k, v] of remembered) if (now - v.at >= REMEMBER_MS) remembered.delete(k);
    if (remembered.size >= MAX_REMEMBERED) remembered.delete(remembered.keys().next().value!);
    const fresh = { at: now, result: check(wallet) };
    remembered.set(wallet, fresh);
    // A failed check is not remembered: the next request asks again.
    fresh.result.catch(() => remembered.get(wallet) === fresh && remembered.delete(wallet));
    entry = fresh;
  }
  try {
    return Response.json(await entry.result, { headers });
  } catch {
    return Response.json({ error: "The network could not be read just now." }, { status: 503, headers });
  }
}
