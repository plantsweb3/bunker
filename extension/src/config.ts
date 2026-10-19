/** What this build of Bunker Watch is allowed to talk to.
 *
 * The published build knows one network: Solana mainnet and the one Bunker
 * program on it, both taken from lib/bunker-config.ts. No setting changes
 * that. A test build is made by scripts/build-extension.mjs --test, which
 * puts a local validator's values in at build time; those values appear
 * nowhere in this source, so they cannot be in a published build. */
import { MAINNET_GENESIS, MAINNET_PROGRAM_ID } from "@/lib/bunker-config";

declare const __BUNKER_WATCH_TEST__: undefined | { rpc: string; program: string; genesis: string };
const test = typeof __BUNKER_WATCH_TEST__ === "undefined" ? undefined : __BUNKER_WATCH_TEST__;

export const NETWORK = test
  ? { label: "LOCAL TEST", program: test.program, genesis: test.genesis, defaultRpc: test.rpc, test: true }
  : {
      label: "MAINNET",
      program: MAINNET_PROGRAM_ID,
      genesis: MAINNET_GENESIS,
      defaultRpc: "https://api.mainnet-beta.solana.com",
      test: false,
    };
export const MAX_WATCHED = 5;
export const SITE = "https://bunkermode.io";
export const STATUS_LINE = "PUBLIC BETA";
/** Said on every alert and every screen, because fake "Bunker" alerts will be used for phishing. */
export const NEVER_ASKS = "Bunker never asks for your recovery kit or its password.";
export const BEST_EFFORT = "Alerts are best effort. Silence is not proof nothing happened.";
export const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;
