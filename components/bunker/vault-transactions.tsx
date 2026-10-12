"use client";
// The bounty vault's history, read from the chain by /api/bounty/transactions.
// Every figure on a row comes from that transaction; a page that could not be
// read in full shows nothing rather than part of a list.
import { useCallback, useEffect, useState } from "react";
import { exactSol, type VaultRow } from "@/lib/vault-transactions";

type Page = { rows: VaultRow[]; next: string | null };
type State = { rows: VaultRow[]; next: string | null; status: "reading" | "read" | "unavailable" };

const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;
const when = (seconds: number) =>
  new Date(seconds * 1000).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

export default function VaultTransactions({ intro }: { intro: string }) {
  const [list, setList] = useState<State>({ rows: [], next: null, status: "reading" });
  const [copied, setCopied] = useState<string | null>(null);
  const fetchPage = useCallback((before: string | null) => {
    fetch(`/api/bounty/transactions${before ? `?before=${before}` : ""}`, { cache: "no-store" })
      .then(async (r) => {
        const page = (await r.json()) as Page;
        if (!r.ok || !Array.isArray(page.rows)) throw new Error("No answer");
        setList((l) => ({ rows: before ? [...l.rows, ...page.rows] : page.rows, next: page.next, status: "read" }));
      })
      .catch(() => setList((l) => ({ ...l, status: "unavailable" })));
  }, []);
  useEffect(() => fetchPage(null), [fetchPage]);
  const load = (before: string | null) => {
    setList((l) => ({ ...l, status: "reading" }));
    fetchPage(before);
  };
  const copy = (row: VaultRow) =>
    row.other &&
    navigator.clipboard?.writeText(row.other).then(
      () => setCopied(row.signature),
      () => {},
    );

  const { rows, next, status } = list;
  return (
    <div className="bm-panel vault-ledger" data-state={status}>
      <div className="bm-panel__head">
        <span>Transactions</span>
      </div>
      <p className="vault-ledger-intro">{intro}</p>
      {rows.length > 0 && (
        <ol className="ledger-rows">
          {rows.map((row) => (
            <li key={row.signature} className={row.direction === "OUT" ? "out" : undefined}>
              {row.time === null ? (
                <span className="when">Time not recorded</span>
              ) : (
                <time className="when" dateTime={new Date(row.time * 1000).toISOString()}>
                  {when(row.time)}
                </time>
              )}
              <span className="what">
                <b>{row.direction}</b>
                {row.label}
              </span>
              <strong>
                {exactSol(row.lamports)}
                <i>SOL</i>
              </strong>
              {row.other ? (
                <button
                  className="other"
                  title={row.other}
                  aria-label={`Copy address ${row.other}`}
                  onClick={() => copy(row)}
                >
                  {copied === row.signature ? "Copied" : short(row.other)}
                </button>
              ) : (
                <span className="other">Network fee</span>
              )}
              <a href={`https://explorer.solana.com/tx/${row.signature}`} target="_blank" rel="noreferrer">
                Explorer
              </a>
            </li>
          ))}
        </ol>
      )}
      <div className="vault-ledger-foot" aria-live="polite">
        {status === "reading" ? (
          <span>Reading…</span>
        ) : status === "unavailable" ? (
          <>
            <span>The network could not be read just now.</span>
            <button className="text-button" onClick={() => load(rows.length ? next : null)}>
              Read again
            </button>
          </>
        ) : next ? (
          <button className="text-button" onClick={() => load(next)}>
            Load more
          </button>
        ) : (
          <span>{rows.length ? "That is every transaction." : "No transactions yet."}</span>
        )}
      </div>
      <p className="micro">
        Each amount is the change in the vault’s balance in that transaction, network fee included. Transactions that
        name the vault without moving its balance are left out.
      </p>
    </div>
  );
}
