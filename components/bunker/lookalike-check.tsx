"use client";
// The lookalike part of "Check a wallet": senders in the wallet's recent
// history that imitate an address it has paid. Read after the balances, so a
// slow history read never holds up the rest of the result.
import { useEffect, useState } from "react";
import { formatAmount } from "@/sdk/bytes";
import { mintLabel } from "@/sdk/known-mints";
import type { Lookalike as Found } from "@/lib/poisoning";

/** As /api/lookalikes sends it: amounts as strings of whole numbers. */
type Lookalike = Omit<Found, "received"> & { received: { lamports: string } | { mint: string; amount: string } };
type State =
  | { status: "reading" }
  | { status: "read"; found: Lookalike[]; asked: number; read: number }
  | { status: "unavailable"; busy: boolean };

/** An address with the parts that match shown, and the middle that differs dimmed. */
function Marked({ address, start, end }: { address: string; start: number; end: number }) {
  return (
    <code className="lookalike-address">
      <b>{address.slice(0, start)}</b>
      <span>{address.slice(start, address.length - end)}</span>
      <b>{address.slice(address.length - end)}</b>
    </code>
  );
}
const what = (r: Lookalike["received"]) =>
  "lamports" in r
    ? `${formatAmount(BigInt(r.lamports), 9)} SOL`
    : `${BigInt(r.amount).toLocaleString("en-US")} base units of ${mintLabel(r.mint) ?? `${r.mint.slice(0, 4)}…${r.mint.slice(-4)}`}`;
const when = (t: number | null) =>
  t === null ? "time not recorded" : new Date(t * 1000).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

export default function LookalikeCheck({ address }: { address: string }) {
  const [state, setState] = useState<State>({ status: "reading" });
  useEffect(() => {
    let current = true;
    fetch(`/api/lookalikes?a=${address}`, { cache: "no-store" })
      .then(async (r) => {
        if (r.status === 429) throw new Error("busy");
        const body = (await r.json()) as { found?: Lookalike[]; asked?: number; read?: number };
        if (!r.ok || !Array.isArray(body.found) || typeof body.asked !== "number" || typeof body.read !== "number")
          throw new Error("No answer");
        if (current) setState({ status: "read", found: body.found, asked: body.asked, read: body.read });
      })
      .catch((e) => current && setState({ status: "unavailable", busy: e instanceof Error && e.message === "busy" }));
    return () => {
      current = false;
    };
  }, [address]);

  if (state.status === "reading")
    return (
      <div className="check-table lookalikes" data-state="reading">
        <h2>Lookalike addresses</h2>
        <p>Reading recent transactions for senders that imitate an address this wallet has paid…</p>
      </div>
    );
  if (state.status === "unavailable")
    return (
      <div className="check-table lookalikes" data-state="unavailable">
        <h2>Lookalike addresses</h2>
        <p>
          {state.busy
            ? "Too many wallets checked from here in the last minute. Wait a minute and check again to include lookalike addresses."
            : "This wallet’s history could not be read just now, so it was not checked for lookalike addresses."}
        </p>
      </div>
    );
  const { found, asked, read } = state;
  const scope =
    read === asked
      ? `the last ${asked.toLocaleString("en-US")} transactions`
      : `${read.toLocaleString("en-US")} of the last ${asked.toLocaleString("en-US")} transactions (the rest could not be read)`;
  return (
    <div className="check-table lookalikes" data-state="read" data-found={found.length}>
      <h2>{found.length ? `${found.length} lookalike ${found.length === 1 ? "address" : "addresses"}` : "Lookalike addresses"}</h2>
      {found.length ? (
        <>
          <p>
            Each of these sent this wallet something and starts and ends like an address it has paid. That is address
            poisoning: the fake waits in your history for the day you copy it. Never copy an address from your
            transaction history. Check every character, or keep the real one somewhere you trust.
          </p>
          <ul className="lookalike-list">
            {found.map((f) => (
              <li key={`${f.sender}:${f.signature}`}>
                <div>
                  <span className="mono">LOOKALIKE</span>
                  <Marked address={f.sender} start={f.start} end={f.end} />
                </div>
                <div>
                  <span className="mono">IMITATES, PAID BY THIS WALLET</span>
                  <Marked address={f.imitates} start={f.start} end={f.end} />
                </div>
                <p>
                  Sent {what(f.received)} · {when(f.time)} ·{" "}
                  <a href={`https://explorer.solana.com/tx/${f.signature}`} target="_blank" rel="noreferrer">
                    Explorer
                  </a>
                </p>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p>
          None found in {scope}. Older history was not checked, and this cannot see an address you have not used yet.
        </p>
      )}
      {found.length > 0 && <p className="micro">Checked {scope}.</p>}
    </div>
  );
}
