import { Connection, PublicKey } from "@solana/web3.js";
import { alertsFromEnv, sameSecret, telegramSend } from "@/lib/alerts/config";
import { handleUpdate } from "@/lib/alerts/commands";
import { boundedText } from "@/lib/bounded-body";
import { getConfig, getRpcUrl } from "@/lib/bunker-config";
/** Telegram calls this for every message sent to the bot. */
export async function POST(request: Request) {
  const alerts = alertsFromEnv();
  const config = getConfig();
  if (!alerts || !config.programId) return new Response("Alerts are not configured", { status: 503 });
  if (!sameSecret(request.headers.get("x-telegram-bot-api-secret-token"), alerts.webhookSecret))
    return new Response("Forbidden", { status: 403 });
  try {
    const update = JSON.parse(await boundedText(request.body, 20000));
    const reply = await handleUpdate(update, {
      store: alerts.store,
      connection: new Connection(getRpcUrl(), "confirmed"),
      program: new PublicKey(config.programId),
    });
    if (reply) await telegramSend(alerts.botToken, reply.chat, reply.text);
  } catch {
    // Acknowledge anyway: Telegram retries anything but a 2xx, forever.
  }
  return new Response("ok");
}
