/** The words of an alert, and what the toolbar badge says.
 *
 * An announced withdrawal gets its own wording, because it is the one alert
 * the owner may have to act on within hours. Every other event uses the
 * alert service's wording from lib/alerts/messages.ts, imported, not copied. */
import { eventText } from "@/lib/alerts/messages";
import type { WatchEvent } from "@/lib/alerts/watch";
import { formatDuration } from "@/sdk/v3/chain";
import { NEVER_ASKS, short } from "./config";
import type { View } from "./store";

export type Notice = {
  vault: string;
  kind: WatchEvent["kind"];
  title: string;
  message: string;
  /** Stays on screen until dismissed. */
  urgent: boolean;
};
export function noticeOf(vault: string, e: WatchEvent, now: bigint): Notice {
  if (e.kind === "announced") {
    const opens = BigInt(e.pending.opensAt);
    return {
      vault,
      kind: e.kind,
      urgent: true,
      title: "Withdrawal announced",
      message: [
        `A withdrawal was announced from Bunker ${short(vault)}.`,
        opens > now ? `Opens in ${formatDuration(opens - now)}.` : "It can be released now.",
        "If this was not you, cancel it now with your cancel file or recovery kit.",
        NEVER_ASKS,
      ].join(" "),
    };
  }
  const lines = eventText(vault, e, now, null).split("\n").filter(Boolean);
  return { vault, kind: e.kind, urgent: false, title: lines[0], message: lines.slice(1).join("\n") };
}
export const ICE = "#A9DEFF";
export const CREAM = "#EAE7DF";
export const INK = "#0E1012";
/** Cream with the hours left when a withdrawal is waiting; otherwise ice with how many are watched. */
export function badgeOf(shown: View[], now: bigint): { text: string; color: string } {
  const waiting = shown.flatMap((v) => (v.pending ? [BigInt(v.pending.opensAt)] : []));
  if (waiting.length) {
    const soonest = waiting.reduce((a, b) => (a < b ? a : b));
    const hours = soonest > now ? (soonest - now + 3599n) / 3600n : 0n;
    return { text: hours > 0n ? `${hours > 999n ? 999n : hours}h` : "now", color: CREAM };
  }
  return { text: shown.length ? String(shown.length) : "", color: ICE };
}
