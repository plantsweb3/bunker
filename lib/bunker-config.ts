// Full getGenesisHash results; these are not truncated CAIP chain identifiers.
export const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export type BunkerConfig = {
  network: "mainnet-beta" | "devnet" | "localnet";
  custodyEnabled: boolean;
  programId: string | null;
  expectedGenesis: string;
  releaseStatus: string;
  /** Telegram bot that sends alerts, when the alert service is fully configured. */
  alertsBot: string | null;
};
export function configFromEnv(
  env: Record<string, string | undefined>,
): BunkerConfig {
  const mode = env.BUNKER_TEST_NETWORK;
  // Mirrors lib/alerts/config.ts: every piece present, or alerts are off.
  const alertsBot =
    env.TELEGRAM_BOT_TOKEN &&
    env.TELEGRAM_WEBHOOK_SECRET &&
    env.CRON_SECRET &&
    env.KV_REST_API_URL &&
    env.KV_REST_API_TOKEN &&
    /^[A-Za-z0-9_]{5,32}$/.test(env.TELEGRAM_BOT_USERNAME ?? "")
      ? env.TELEGRAM_BOT_USERNAME!
      : null;
  const enabled =
    env.BUNKER_ENABLE_TEST_CUSTODY === "true" &&
    (mode === "devnet" || mode === "localnet") &&
    !!env.BUNKER_TEST_PROGRAM_ID;
  return enabled
    ? {
        network: mode as "devnet" | "localnet",
        custodyEnabled: true,
        programId: env.BUNKER_TEST_PROGRAM_ID!,
        expectedGenesis:
          mode === "devnet" ? DEVNET_GENESIS : (env.BUNKER_LOCAL_GENESIS ?? ""),
        releaseStatus: "Experimental test custody. Valueless assets only.",
        alertsBot,
      }
    : {
        network: "mainnet-beta",
        custodyEnabled: false,
        programId: null,
        expectedGenesis: MAINNET_GENESIS,
        releaseStatus:
          "Mainnet custody is locked pending independent cryptographic and program review.",
        // Nothing to watch while no program is configured.
        alertsBot: null,
      };
}
export function getConfig() {
  return configFromEnv(process.env);
}
export function getRpcUrl() {
  const c = getConfig();
  if (c.network === "localnet") {
    const u = new URL(
      process.env.BUNKER_TEST_RPC_URL ?? "http://127.0.0.1:19099",
    );
    if (!["127.0.0.1", "localhost"].includes(u.hostname))
      throw new Error("Local test RPC must use loopback");
    return u.href;
  }
  const url =
    process.env.SOLANA_RPC_URL ??
    (c.network === "devnet"
      ? "https://api.devnet.solana.com"
      : "https://api.mainnet-beta.solana.com");
  if (new URL(url).protocol !== "https:")
    throw new Error("Remote RPC must use HTTPS");
  return url;
}
