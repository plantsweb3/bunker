import { timingSafeEqual } from "node:crypto";
import { RestStore, WatchStore } from "./store";
export type AlertsConfig = {
  botToken: string;
  botUsername: string;
  webhookSecret: string;
  cronSecret: string;
  store: WatchStore;
};
/** Alerts exist only when every piece is configured. Anything less is off. */
export function alertsFromEnv(env: Record<string, string | undefined> = process.env): AlertsConfig | null {
  const {
    TELEGRAM_BOT_TOKEN: botToken,
    TELEGRAM_BOT_USERNAME: botUsername,
    TELEGRAM_WEBHOOK_SECRET: webhookSecret,
    CRON_SECRET: cronSecret,
    KV_REST_API_URL: url,
    KV_REST_API_TOKEN: token,
  } = env;
  if (!botToken || !botUsername || !webhookSecret || !cronSecret || !url || !token) return null;
  if (!/^[A-Za-z0-9_]{5,32}$/.test(botUsername) || webhookSecret.length < 24 || cronSecret.length < 24)
    return null;
  return { botToken, botUsername, webhookSecret, cronSecret, store: new RestStore(url, token) };
}
export function sameSecret(given: string | null, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export async function telegramSend(botToken: string, chat: string, text: string): Promise<void> {
  const r = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // No parse_mode: text is never interpreted as markup.
    body: JSON.stringify({ chat_id: chat, text: text.slice(0, 3500), disable_web_page_preview: true }),
    signal: AbortSignal.timeout(8000),
    redirect: "error",
  });
  if (!r.ok) throw new Error("Telegram delivery failed");
}
