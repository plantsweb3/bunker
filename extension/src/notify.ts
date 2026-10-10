/** The words of an alert, and what the toolbar badge says.
 *
 * An announced withdrawal gets its own wording, because it is the one alert
 * the owner may have to act on within hours. Every other event uses the
 * alert service's wording from lib/alerts/messages.ts, imported, not copied. */
import { eventText } from "@/lib/alerts/messages";
import type { WatchEvent } from "@/lib/alerts/watch";
import { formatDuration } from "@/sdk/v3/chain";
import { NEVER_ASKS, short } from "./config";
import type { Notice, Status, View } from "./store";
import { blind } from "./store";

export type { Notice };
export function noticeOf(vault: string, e: WatchEvent, now: bigint): Notice {
  const lines = eventText(vault, e, now, null).split("\n").filter(Boolean);
  if (e.kind === "announced") {
    const opens = BigInt(e.pending.opensAt);
    return {
      id: `announced:${vault}:${e.pending.digest}`,
      vault,
      kind: e.kind,
      urgent: true,
      title: "Withdrawal announced",
      message: [
        `A withdrawal was announced from Bunker ${short(vault)}.`,
        // The amount and the whole destination, in the alert service's words.
        `${lines[1]}.`,
        opens > now ? `Opens in ${formatDuration(opens - now)}.` : "It can be released now.",
        "If this was not you, cancel it now with your cancel file or recovery kit.",
        NEVER_ASKS,
      ].join(" "),
    };
  }
  return { id: `${e.kind}:${vault}:${now}`, vault, kind: e.kind, urgent: false, title: lines[0], message: lines.slice(1).join("\n") };
}
/** Said once when the network has not been readable for a while: a watcher
 * that cannot see must not look like one that sees nothing wrong. */
export const blindNotice = (since: number): Notice => ({
  id: `blind::${since}`,
  vault: "",
  kind: "blind",
  urgent: true,
  title: "Bunker Watch cannot read the network",
  message: `It has not been able to check your Bunkers for several minutes, so it would not see a withdrawal being announced. Check your connection or the RPC endpoint in Settings, or look at your Bunker on bunkermode.io. ${NEVER_ASKS}`,
});
export const ICE = "#A9DEFF";
export const CREAM = "#EAE7DF";
export const INK = "#0E1012";
/** Cream with "!" when it cannot see; cream with the hours left when a
 * withdrawal is waiting; otherwise ice with how many are watched. */
export function badgeOf(views: View[], now: bigint, status?: Status, wallClock = Date.now()): { text: string; color: string } {
  if (views.length && status && blind(status, wallClock)) return { text: "!", color: CREAM };
  // A record past its deadline can no longer leave; it is not waiting.
  const waiting = views.flatMap((v) => (v.pending && now <= BigInt(v.pending.deadline) ? [BigInt(v.pending.opensAt)] : []));
  if (waiting.length) {
    const soonest = waiting.reduce((a, b) => (a < b ? a : b));
    const hours = soonest > now ? (soonest - now + 3599n) / 3600n : 0n;
    return { text: hours > 0n ? `${hours > 999n ? 999n : hours}h` : "now", color: CREAM };
  }
  return { text: views.length ? String(views.length) : "", color: ICE };
}
