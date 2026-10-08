/** Alert wording. Plain text only: no markup is ever sent, so nothing read from
 * the chain can change how a message renders. */
import { formatAmount } from "@/sdk/bytes";
import { mintLabel } from "@/sdk/known-mints";
import { formatDuration } from "@/sdk/v3/chain";
import type { PendingView, WatchEvent } from "./watch";
export const FOOTER = "Bunker will never ask for your recovery kit or day key by message.";
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const name = (mint: string) => mintLabel(mint) ?? short(mint);
const sol = (lamports: bigint) => `${formatAmount(lamports, 9)} SOL`;
/** A record's amount and destination, exactly as the vault account holds them. */
const record = (p: PendingView) =>
  `${p.kind === 0 ? sol(BigInt(p.amount)) : `${p.amount} base units of token ${name(p.mint)}`} to ${p.destination}`;
const RECOVER =
  "Not you? Open the offline recovery tool with your recovery kit, make a recovery packet, and submit it at bunkermode.io/recovery. That replaces your keys.";
/** The text for one change in a watched vault. */
export function eventText(
  vault: string,
  e: WatchEvent,
  now: bigint,
  link: string | null,
): string {
  const head = `Bunker ${short(vault)}`;
  const lines: string[] = [];
  if (e.kind === "deposit") lines.push(`${head}: deposit received.`, `+${sol(e.lamports)}`);
  else if (e.kind === "announced") {
    const opens = BigInt(e.pending.opensAt);
    lines.push(
      `${head}: a withdrawal was ANNOUNCED. Nothing has left yet.`,
      record(e.pending),
      opens > now
        ? `It can leave in ${formatDuration(opens - now)}.`
        : "Its waiting period is over; it can be released now.",
      `${RECOVER} It also cancels this withdrawal.`,
    );
  } else if (e.kind === "left")
    lines.push(
      e.count === 1
        ? `${head}: a withdrawal left your Bunker.`
        : `${head}: ${e.count} withdrawals left your Bunker.`,
      e.record
        ? record(e.record)
        : e.lamports > 0n
          ? `−${sol(e.lamports)} since the last check`
          : "A token withdrawal. Open your Bunker to see what moved.",
      `Not you? Your day key is compromised. ${RECOVER}`,
    );
  else if (e.kind === "ended")
    lines.push(
      `${head}: an announced withdrawal is no longer waiting. It was released at its deadline, or it expired and was cleared.`,
      record(e.record),
      "Open your Bunker to see which.",
    );
  else
    lines.push(
      `${head}: NEW KEYS were installed. Every earlier day key is dead${e.cancelled ? " and the waiting withdrawal was cancelled" : ""}.`,
      ...(e.cancelled ? [`Cancelled: ${record(e.cancelled)}`] : []),
      "Not you? Then someone else has your recovery kit. Withdraw everything to a new wallet immediately.",
    );
  if (link) lines.push(link);
  lines.push("", FOOTER);
  return lines.join("\n");
}
export const WELCOME = (vault: string) =>
  [
    `Watching Bunker ${short(vault)}.`,
    "You will get a message here when SOL arrives, a withdrawal is announced or leaves, or its keys are replaced. Token deposits are not reported.",
    "Alerts are best effort and can be late or missing. Silence is not proof that nothing happened.",
    "Send /list to see what you are watching, /stop to stop everything.",
    "",
    FOOTER,
  ].join("\n");
