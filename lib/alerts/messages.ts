/** Alert wording. Plain text only: no markup is ever sent, so nothing read from
 * the chain can change how a message renders. */
import { formatAmount } from "@/sdk/bytes";
import { mintLabel } from "@/sdk/known-mints";
import { formatDuration } from "@/sdk/v3/chain";
import type { Activity } from "@/sdk/v3/history";
import type { VaultState } from "@/sdk/v3/protocol";
export const FOOTER = "Bunker will never ask for your recovery kit or day key by message.";
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const name = (mint: string) => mintLabel(mint) ?? short(mint);
const magnitude = (n: bigint) => (n < 0n ? -n : n);
function amounts(a: Activity): string {
  const parts = [
    ...(a.sol !== 0n ? [`${formatAmount(magnitude(a.sol), 9)} SOL`] : []),
    ...a.tokens.map((t) => `${formatAmount(magnitude(t.delta), t.decimals)} ${name(t.mint)}`),
  ];
  return parts.length ? parts.join(" and ") : "an amount this alert could not read";
}
/** The text for one event, or null when the event is not worth a message. */
export function alertText(
  vault: string,
  a: Activity,
  state: VaultState | null,
  now: bigint,
  link: string | null,
): string | null {
  if (a.failed || a.kind === "built" || a.kind === "other") return null;
  const head = `Bunker ${short(vault)}`;
  const lines: string[] = [];
  if (a.kind === "deposit") lines.push(`${head}: deposit received.`, `+${amounts(a)}`);
  else if (a.kind === "announced") {
    const p = state?.pending;
    lines.push(`${head}: a withdrawal was ANNOUNCED. Nothing has left yet.`);
    if (p) {
      lines.push(
        `${p.kind === 0 ? `${formatAmount(p.amount, 9)} SOL` : `${p.amount.toString()} units of ${name(p.mint.toBase58())}`} to ${p.destination.toBase58()}`,
        p.opensAt > now
          ? `It can leave in ${formatDuration(p.opensAt - now)}.`
          : "Its waiting period is over; it can be released now.",
      );
    }
    lines.push(
      "Not you? Open the offline recovery tool with your recovery kit, make a recovery packet, and submit it at bunkermode.io/recovery. That cancels it and replaces your keys.",
    );
  } else if (a.kind === "sent" || a.kind === "released")
    lines.push(
      `${head}: a withdrawal ${a.kind === "sent" ? "was sent" : "was released"}.`,
      `−${amounts(a)}`,
      "Not you? Your day key is compromised. Use your recovery kit in the offline tool to install new keys now.",
    );
  else if (a.kind === "cleared")
    lines.push(`${head}: an expired withdrawal was cleared. Nothing moved.`);
  else if (a.kind === "recovered")
    lines.push(
      `${head}: NEW KEYS were installed. Every earlier day key is dead and any waiting withdrawal was cancelled.`,
      "Not you? Then someone else has your recovery kit. Withdraw everything to a new wallet immediately.",
    );
  if (link) lines.push(link);
  lines.push("", FOOTER);
  return lines.join("\n");
}
export const WELCOME = (vault: string) =>
  [
    `Watching Bunker ${short(vault)}.`,
    "You will get a message here when a deposit arrives, a withdrawal is announced, sent or released, or its keys are replaced.",
    "Alerts are best effort and can be late or missing. Silence is not proof that nothing happened.",
    "Send /list to see what you are watching, /stop to stop everything.",
    "",
    FOOTER,
  ].join("\n");
