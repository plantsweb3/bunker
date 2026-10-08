// Full getGenesisHash results; these are not truncated CAIP chain identifiers.
export const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export type BunkerConfig = {
  network: "mainnet-beta" | "devnet" | "localnet";
  custodyEnabled: boolean;
  programId: string | null;
  /** Which draft protocol the configured TEST program implements. */
  protocolVersion: 2 | 3;
  expectedGenesis: string;
  releaseStatus: string;
};
export function configFromEnv(
  env: Record<string, string | undefined>,
): BunkerConfig {
  const mode = env.BUNKER_TEST_NETWORK;
  const enabled =
    env.BUNKER_ENABLE_TEST_CUSTODY === "true" &&
    (mode === "devnet" || mode === "localnet") &&
    !!env.BUNKER_TEST_PROGRAM_ID;
  return enabled
    ? {
        network: mode as "devnet" | "localnet",
        custodyEnabled: true,
        programId: env.BUNKER_TEST_PROGRAM_ID!,
        protocolVersion: env.BUNKER_TEST_PROTOCOL === "3" ? 3 : 2,
        expectedGenesis:
          mode === "devnet" ? DEVNET_GENESIS : (env.BUNKER_LOCAL_GENESIS ?? ""),
        releaseStatus: "Experimental test custody. Valueless assets only.",
      }
    : {
        network: "mainnet-beta",
        custodyEnabled: false,
        programId: null,
        protocolVersion: 2,
        expectedGenesis: MAINNET_GENESIS,
        releaseStatus:
          "Mainnet custody is locked pending independent cryptographic and program review.",
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
