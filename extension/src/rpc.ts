/** The network connection. Bunker Watch talks to one RPC endpoint, the one
 * the user chose or the default, and to nothing else. Before anything an
 * endpoint says is believed, its genesis hash must be the pinned one. */
import { Connection } from "@solana/web3.js";
import { NETWORK } from "./config";
import type { Settings } from "./store";

export class WrongNetwork extends Error {
  constructor() {
    super(`That RPC endpoint is not ${NETWORK.test ? "the test network" : "Solana mainnet"}. Nothing was read from it.`);
  }
}
/** An https address with nothing hidden in it. A test build may also use this computer. */
export function endpoint(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("That is not a web address.");
  }
  // A test build may use its own validator, which is the one address it was built with.
  const local = NETWORK.test && url.origin === new URL(NETWORK.defaultRpc).origin;
  if (url.protocol !== "https:" && !local) throw new Error("Use an https RPC address.");
  if (url.username || url.password) throw new Error("Put the key in the address path or query, not before an @.");
  return url;
}
export const endpointOf = (s: Settings) => endpoint(s.rpc ?? NETWORK.defaultRpc);
/** No request waits longer than this. An endpoint that accepts a request and
 * never answers must count as a failure, not as silence. */
const TIME_LIMIT_MS = 15_000;
export const connect = (url: URL) =>
  new Connection(url.href, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
    fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(TIME_LIMIT_MS) }),
  });
export async function assertGenesis(connection: Pick<Connection, "getGenesisHash">) {
  if ((await connection.getGenesisHash()) !== NETWORK.genesis) throw new WrongNetwork();
}
/** The endpoint said to slow down. */
export const refused = (e: unknown) => /\b429\b|too many requests/i.test(e instanceof Error ? e.message : "");
