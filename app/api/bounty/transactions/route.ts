import { getConfig, getRpcUrl } from "@/lib/bunker-config";
import { boundedText } from "@/lib/bounded-body";
import { rewardAccountsOf } from "@/lib/creator-reward-accounts";
import { getLaunch } from "@/lib/launch-config";
import { clientOf, rateLimiter } from "@/lib/rate-limit";
import { labelsFrom, PAGE, rowOf, SIGNATURE, type ChainTransaction, type VaultRow } from "@/lib/vault-transactions";
import checkedIn from "@/lib/vault-labels.json";

/** The bounty vault's history, a page at a time, newest first. Each page is
 * one signature list and one read per transaction, so it is remembered for a
 * minute: a busy page costs the site's RPC quota once, not once per visitor. */
type Page = { rows: VaultRow[]; next: string | null };
const REMEMBER_MS = 60_000;
const MAX_REMEMBERED = 40;
const remembered = new Map<string, { at: number; page: Promise<Page> }>();
const allow = rateLimiter(30, 60_000);
const labels = labelsFrom(checkedIn);
/** The same limits /api/rpc keeps on what one upstream answer may be. */
const MAX_RESPONSE_BYTES = 1_500_000;
const AT_ONCE = 5;

async function ask<T>(method: string, params: unknown[]): Promise<T> {
  const r = await fetch(getRpcUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(18000),
    redirect: "error",
  });
  if (!r.ok) throw new Error("RPC unavailable");
  const answer = JSON.parse(await boundedText(r.body, MAX_RESPONSE_BYTES)) as { result?: T };
  if (answer.result === undefined || answer.result === null) throw new Error("No answer");
  return answer.result;
}
/** A page is all of its transactions or it is a failure. One that could not
 * be read is never left out, because the list says it is every transaction. */
async function read(vault: string, before: string | null): Promise<Page> {
  const seen = await ask<{ signature: string; blockTime?: number | null }[]>("getSignaturesForAddress", [
    vault,
    { limit: PAGE, commitment: "confirmed", ...(before ? { before } : {}) },
  ]);
  if (!Array.isArray(seen) || seen.length > PAGE || !seen.every((s) => SIGNATURE.test(s?.signature)))
    throw new Error("Unexpected answer");
  const rewards = rewardAccountsOf(vault);
  const rows: (VaultRow | null)[] = new Array(seen.length).fill(null);
  let turn = 0;
  await Promise.all(
    Array.from({ length: Math.min(AT_ONCE, seen.length) }, async () => {
      for (let i = turn++; i < seen.length; i = turn++) {
        const tx = await ask<ChainTransaction>("getTransaction", [
          seen[i].signature,
          { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: 0 },
        ]);
        rows[i] = rowOf(seen[i], tx, vault, rewards, labels);
      }
    }),
  );
  return {
    rows: rows.filter((row) => row !== null),
    next: seen.length === PAGE ? seen[PAGE - 1].signature : null,
  };
}
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!allow(clientOf(request)))
    return new Response("Too many requests", { status: 429, headers: { ...headers, "Retry-After": "30" } });
  const before = new URL(request.url).searchParams.get("before");
  if (before !== null && !SIGNATURE.test(before)) return new Response("Invalid request", { status: 400, headers });
  const { bountyWallet } = getLaunch();
  // The vault is a mainnet address. A test setup reads another network, where
  // the same address would have a different history.
  if (!bountyWallet || getConfig().network !== "mainnet-beta")
    return Response.json({ error: "The bounty vault has not been published." }, { status: 404, headers });
  const key = `${bountyWallet}:${before ?? ""}`;
  const now = Date.now();
  let entry = remembered.get(key);
  if (!entry || now - entry.at >= REMEMBER_MS) {
    for (const [k, v] of remembered) if (now - v.at >= REMEMBER_MS) remembered.delete(k);
    if (remembered.size >= MAX_REMEMBERED) remembered.delete(remembered.keys().next().value!);
    entry = { at: now, page: read(bountyWallet, before) };
    remembered.set(key, entry);
    // A failed read is not remembered: the next request asks again.
    entry.page.catch(() => remembered.get(key) === entry && remembered.delete(key));
  }
  try {
    return Response.json(await entry.page, { headers });
  } catch {
    return Response.json({ error: "The network could not be read just now." }, { status: 503, headers });
  }
}
