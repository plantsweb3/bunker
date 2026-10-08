// One-time: points the Telegram bot at this site's webhook.
//   TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... node scripts/telegram-setup.mjs https://bunkermode.io
// Reads secrets from the environment only; prints neither.
const [site] = process.argv.slice(2);
const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_WEBHOOK_SECRET: secret } = process.env;
if (!site || !/^https:\/\/[a-z0-9.-]+$/.test(site) || !token || !secret || secret.length < 24) {
  console.error("Usage: TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=<24+ chars> node scripts/telegram-setup.mjs https://your-site");
  process.exit(1);
}
const call = async (method, body) => {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await r.json();
  if (!json.ok) throw new Error(`${method} failed: ${json.description ?? r.status}`);
  return json.result;
};
await call("setWebhook", {
  url: `${site}/api/telegram`,
  secret_token: secret,
  allowed_updates: ["message"],
  // One update at a time, so two subscription changes never interleave.
  max_connections: 1,
  drop_pending_updates: true,
});
await call("setMyCommands", {
  commands: [
    { command: "list", description: "Bunkers you are watching" },
    { command: "stop", description: "Stop all alerts" },
  ],
});
const me = await call("getMe", {});
console.log(`Webhook set for @${me.username} -> ${site}/api/telegram`);
console.log(`Set TELEGRAM_BOT_USERNAME=${me.username} in the site's environment.`);
