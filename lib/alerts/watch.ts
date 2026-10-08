/** One pass of the alert watcher: for a bounded number of watched vaults, find
 * transactions newer than the last one reported and tell every subscriber.
 * The cursor moves only after an event's messages have been attempted, so a
 * crash mid-pass can repeat an alert. A delivery that Telegram refuses (the
 * user blocked the bot, an outage) is counted and NOT retried: alerts are best
 * effort, and one unreachable chat must not hold up or duplicate the others. */
import { Connection, PublicKey } from "@solana/web3.js";
import { chainTime, fetchVault } from "@/sdk/v3/chain";
import { describeTransaction, FetchedTransaction } from "@/sdk/v3/history";
import type { VaultState } from "@/sdk/v3/protocol";
import { alertText } from "./messages";
import type { WatchStore } from "./store";
export type Send = (chat: string, text: string) => Promise<void>;
export type WatchResult = { vaults: number; events: number; messages: number; errors: number };
const PER_VAULT = 10;
export async function runWatch(options: {
  store: WatchStore;
  connection: Connection;
  program: PublicKey;
  send: Send;
  link: (signature: string) => string | null;
  maxVaults?: number;
}): Promise<WatchResult> {
  const { store, connection, program, send, link } = options;
  const result: WatchResult = { vaults: 0, events: 0, messages: 0, errors: 0 };
  const vaults = await store.nextVaults(options.maxVaults ?? 25);
  if (vaults.length === 0) return result;
  const now = await chainTime(connection);
  for (const address of vaults) {
    result.vaults++;
    try {
      const vault = new PublicKey(address);
      const until = (await store.cursor(address)) ?? undefined;
      const found = await connection.getSignaturesForAddress(vault, { until, limit: PER_VAULT });
      if (found.length === 0) continue;
      if (!until) {
        // First sight of this vault: start from now, do not replay its history.
        await store.setCursor(address, found[0].signature);
        continue;
      }
      const chats = await store.chatsOf(address);
      let state: VaultState | null = null;
      try {
        state = (await fetchVault(connection, program, vault)).state;
      } catch {
        /* Describe events without the pending record. */
      }
      // Oldest first, so the cursor only ever moves forward.
      for (const s of [...found].reverse()) {
        const tx = await connection.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 });
        if (!tx) break; // Not available yet; try again next pass.
        const activity = describeTransaction(s.signature, tx as unknown as FetchedTransaction, program, vault);
        const text = alertText(address, activity, state, now, link(s.signature));
        if (text) {
          result.events++;
          for (const chat of chats) {
            try {
              await send(chat, text);
              result.messages++;
            } catch {
              result.errors++;
            }
          }
        }
        await store.setCursor(address, s.signature);
      }
    } catch {
      result.errors++;
    }
  }
  return result;
}
