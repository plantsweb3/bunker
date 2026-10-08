import { Connection, PublicKey } from "@solana/web3.js";
import { alertsFromEnv, sameSecret, telegramSend } from "@/lib/alerts/config";
import { runWatch } from "@/lib/alerts/watch";
import { getConfig, getRpcUrl } from "@/lib/bunker-config";
import { explorer } from "@/sdk/client";
export const maxDuration = 55;
/** Called by the scheduler once a minute (see vercel.json). */
export async function GET(request: Request) {
  const alerts = alertsFromEnv();
  const config = getConfig();
  // No bot, no store, or no program to watch: nothing to do.
  if (!alerts || !config.programId) return Response.json({ enabled: false });
  const bearer = request.headers.get("authorization");
  if (!sameSecret(bearer?.startsWith("Bearer ") ? bearer.slice(7) : null, alerts.cronSecret))
    return new Response("Forbidden", { status: 403 });
  const result = await runWatch({
    store: alerts.store,
    connection: new Connection(getRpcUrl(), "confirmed"),
    program: new PublicKey(config.programId),
    send: (chat, text) => telegramSend(alerts.botToken, chat, text),
    link: (signature) => explorer(signature, config.network),
  });
  return Response.json({ enabled: true, ...result }, { headers: { "Cache-Control": "no-store" } });
}
