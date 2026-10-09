/** Two public addresses the site shows. Nothing that holds or moves funds
 * reads them. They are set in the environment, and can be set ahead of time:
 * neither is shown, or sent to a browser, until BUNKER_LAUNCH_LIVE is "true".
 * Until then the site says they are not published. A value that is not a
 * Solana address is treated as absent. */
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const address = (value: string | undefined) => (value && ADDRESS.test(value) ? value : null);
export type Launch = {
  /** The Bunker Mode coin's mint address. */
  coinAddress: string | null;
  /** The wallet that bug bounties are paid from. */
  bountyWallet: string | null;
};
export function launchFromEnv(env: Record<string, string | undefined>): Launch {
  const live = env.BUNKER_LAUNCH_LIVE === "true";
  return {
    coinAddress: live ? address(env.BUNKER_COIN_ADDRESS) : null,
    bountyWallet: live ? address(env.BOUNTY_WALLET_ADDRESS) : null,
  };
}
export const getLaunch = () => launchFromEnv(process.env);
