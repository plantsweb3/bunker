/** Handles one Telegram update. Only private chats, only three commands. */
import { Connection, PublicKey } from "@solana/web3.js";
import { fetchVault } from "@/sdk/v3/chain";
import { FOOTER, WELCOME } from "./messages";
import { MAX_VAULTS_PER_CHAT, WatchStore } from "./store";
type Update = {
  message?: { text?: unknown; chat?: { id?: unknown; type?: unknown } };
};
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
export async function handleUpdate(
  update: Update,
  deps: { store: WatchStore; connection: Connection; program: PublicKey },
): Promise<{ chat: string; text: string } | null> {
  const message = update?.message;
  const id = message?.chat?.id;
  if (!message || message.chat?.type !== "private" || typeof message.text !== "string") return null;
  if (typeof id !== "number" || !Number.isSafeInteger(id)) return null;
  const chat = String(id);
  const [command, argument] = message.text.trim().split(/\s+/, 2);
  const reply = (text: string) => ({ chat, text });
  if (command === "/stop") {
    const stopped = await deps.store.unsubscribe(chat);
    return reply(stopped.length ? `Stopped. No longer watching ${stopped.length} Bunker(s).` : "You were not watching anything.");
  }
  if (command === "/list") {
    const mine = await deps.store.vaultsOf(chat);
    return reply(mine.length ? `Watching:\n${mine.join("\n")}\n\n/stop ends all of them.` : "Not watching anything. Open your Bunker and choose Telegram alerts.");
  }
  if (command !== "/start") return reply("Commands: /list, /stop. To watch a Bunker, use the Telegram alerts link on its page.");
  if (!argument || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(argument))
    return reply("Open your Bunker at bunkermode.io and choose Telegram alerts to start watching it.");
  let vault: PublicKey;
  try {
    vault = new PublicKey(argument);
    // Only real Bunkers under this program can be watched.
    await fetchVault(deps.connection, deps.program, vault);
  } catch {
    return reply(`That is not a Bunker on this network.\n\n${FOOTER}`);
  }
  const latest = await deps.connection.getSignaturesForAddress(vault, { limit: 1 });
  const ok = await deps.store.subscribe(chat, vault.toBase58(), latest[0]?.signature ?? null);
  return reply(
    ok
      ? WELCOME(vault.toBase58())
      : `You can watch up to ${MAX_VAULTS_PER_CHAT} Bunkers. Send /stop to clear them, then try again.\n(${short(vault.toBase58())} was not added.)`,
  );
}
