"use client";
// The vault's payment wallet on Ethereum: what it holds, read by
// /api/bounty/payment-wallet. A figure is shown only when that read succeeded.
import { useCallback, useEffect, useState } from "react";

type Payment = { hash: string; time: number; usdt: string; to: string; label: string };
type Holdings = { address: string; usdt: string; eth: string; payments: Payment[] };
const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
const when = (seconds: number) =>
  new Date(seconds * 1000).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
type Reading = { state: "reading" } | { state: "read"; holdings: Holdings; at: Date } | { state: "unavailable" };

export default function PaymentWallet({ address }: { address: string }) {
  const [reading, setReading] = useState<Reading>({ state: "reading" });
  const read = useCallback(() => {
    fetch("/api/bounty/payment-wallet", { cache: "no-store" })
      .then(async (r) => {
        const holdings = (await r.json()) as Holdings;
        if (!r.ok || typeof holdings.usdt !== "string" || typeof holdings.eth !== "string" || !Array.isArray(holdings.payments))
          throw new Error("No answer");
        setReading({ state: "read", holdings, at: new Date() });
      })
      .catch(() => setReading({ state: "unavailable" }));
  }, []);
  useEffect(() => read(), [read]);
  return (
    <div className="bm-panel payment-wallet" data-state={reading.state}>
      <div className="bm-panel__head">
        <span>Payment wallet · Ethereum</span>
      </div>
      <div className="payment-wallet-body">
        <div className="payment-wallet-read" aria-live="polite">
          {reading.state === "read" ? (
            <>
              <strong>
                {reading.holdings.usdt}
                <i>USDT</i>
              </strong>
              <strong>
                {reading.holdings.eth}
                <i>ETH</i>
              </strong>
              <span className="micro">
                Last updated {reading.at.toLocaleTimeString("en-US")}. Read from Ethereum.
              </span>
            </>
          ) : (
            <strong className="quiet">{reading.state === "reading" ? "Reading…" : "Balance unavailable"}</strong>
          )}
        </div>
        <div>
          <p>
            Some payments are asked for in USDT on Ethereum. For those, SOL leaves the vault, is swapped, and is paid
            out from this address.
          </p>
          <code className="address">{address}</code>
          <div className="gauge-actions">
            <button className="text-button" onClick={read}>
              Read again
            </button>
            <a href={`https://etherscan.io/address/${address}`} target="_blank" rel="noreferrer">
              See it on Etherscan
            </a>
          </div>
        </div>
      </div>
      {reading.state === "read" && reading.holdings.payments.length > 0 && (
        <ol className="ledger-rows">
          {reading.holdings.payments.map((paid) => (
            <li key={paid.hash} className="out">
              <time className="when" dateTime={new Date(paid.time * 1000).toISOString()}>
                {when(paid.time)}
              </time>
              <span className="what">
                <b>OUT</b>
                {paid.label}
              </span>
              <strong>
                {paid.usdt}
                <i>USDT</i>
              </strong>
              <span className="other" title={paid.to}>
                {short(paid.to)}
              </span>
              <a href={`https://etherscan.io/tx/${paid.hash}`} target="_blank" rel="noreferrer">
                Etherscan
              </a>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
