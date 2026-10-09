// Full getGenesisHash results; these are not truncated CAIP chain identifiers.
export const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
/** The one Bunker program on Solana mainnet. Nothing in this repository sends
 * a transaction to mainnet for any other program address, and no environment
 * variable can change which one this is. Deployed from commit 2182e5f;
 * docs/DEPLOYMENT.md records the build hash and who can upgrade it. */
export const MAINNET_PROGRAM_ID = "DGXACBwbUqRKRVR1TQojZBoRuV2TZJ8wVnQSuLKm2nJJ";
/** A file's network label is a convenience for people; the genesis hash is
 * what binds it. The two must still agree, so that no file can call mainnet
 * a test network or the reverse. */
export const labelMatchesGenesis = (f: { network: string; genesis: string }) =>
  (f.network === "mainnet-beta") === (f.genesis === MAINNET_GENESIS);
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
  // The same conditions as lib/alerts/config.ts: every piece present and
  // well formed, or alerts are off and not advertised.
  const alertsBot =
    env.TELEGRAM_BOT_TOKEN &&
    (env.TELEGRAM_WEBHOOK_SECRET ?? "").length >= 24 &&
    (env.CRON_SECRET ?? "").length >= 24 &&
    env.KV_REST_API_URL &&
    env.KV_REST_API_TOKEN &&
    /^[A-Za-z0-9_]{5,32}$/.test(env.TELEGRAM_BOT_USERNAME ?? "")
      ? env.TELEGRAM_BOT_USERNAME!
      : null;
  // A malformed program id leaves custody off rather than half configured.
  const enabled =
    env.BUNKER_ENABLE_TEST_CUSTODY === "true" &&
    (mode === "devnet" || mode === "localnet") &&
    /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(env.BUNKER_TEST_PROGRAM_ID ?? "");
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
        custodyEnabled: true,
        programId: MAINNET_PROGRAM_ID,
        expectedGenesis: MAINNET_GENESIS,
        releaseStatus: "Public beta on Solana mainnet. Not audited.",
        alertsBot,
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
