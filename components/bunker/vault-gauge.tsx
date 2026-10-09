"use client";
// A read-only gauge of one wallet's SOL balance, drawn as a round vault door
// with a ring of segments. It reads through the site's own RPC route and
// shows a number only when that read succeeded: no cached figure, no
// placeholder. Pass `goal` to make the ring a measure against a target; with
// no goal the ring is simply lit when the balance has been read. Whatever is
// passed as children (a clip, a still) is shown inside the door.
import { type ReactNode, useCallback, useEffect, useState } from "react";

const SEGMENTS = 34;
const REFRESH_MS = 60_000;
type Reading = { state: "reading" } | { state: "read"; sol: number; at: Date } | { state: "unavailable" };

async function balanceOf(address: string): Promise<number> {
  const r = await fetch("/api/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [address, { commitment: "confirmed" }] }),
    cache: "no-store",
  });
  const body = (await r.json()) as { result?: { value?: unknown } };
  const lamports = body.result?.value;
  if (!r.ok || typeof lamports !== "number" || !Number.isSafeInteger(lamports) || lamports < 0)
    throw new Error("No balance in the answer");
  return lamports / 1e9;
}

export default function VaultGauge({
  address,
  goal,
  label = "In the vault",
  children,
}: {
  address: string | null;
  /** A target in SOL. Optional. */
  goal?: number;
  label?: string;
  children?: ReactNode;
}) {
  const [reading, setReading] = useState<Reading>(address ? { state: "reading" } : { state: "unavailable" });
  const read = useCallback(() => {
    if (!address) return;
    balanceOf(address).then(
      (sol) => setReading({ state: "read", sol, at: new Date() }),
      () => setReading({ state: "unavailable" }),
    );
  }, [address]);
  useEffect(() => {
    read();
    const timer = setInterval(() => document.visibilityState === "visible" && read(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [read]);

  const lit =
    reading.state !== "read" ? 0 : goal ? Math.round(Math.min(1, reading.sol / goal) * SEGMENTS) : SEGMENTS;
  return (
    <div className="gauge" data-state={reading.state}>
      <div className="gauge-door">
        <div className="gauge-media">{children}</div>
        <svg viewBox="0 0 200 200" aria-hidden="true">
          {Array.from({ length: SEGMENTS }, (_, i) => (
            <rect
              key={i}
              className={i < lit ? "lit" : ""}
              x="96.5"
              y="3"
              width="7"
              height="13"
              rx="1"
              transform={`rotate(${(360 / SEGMENTS) * i} 100 100)`}
              style={{ transitionDelay: `${i * 18}ms` }}
            />
          ))}
        </svg>
      </div>
      <div className="gauge-read" aria-live="polite">
        <span className="mono">{label}</span>
        {reading.state === "read" ? (
          <>
            <strong>
              {reading.sol.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 3 })}
              <i>SOL</i>
            </strong>
            <span className="micro">
              Last updated {reading.at.toLocaleTimeString("en-US")}. Read from the network.
            </span>
          </>
        ) : reading.state === "reading" ? (
          <strong className="quiet">Reading…</strong>
        ) : (
          <>
            <strong className="quiet">Balance unavailable</strong>
            <span className="micro">
              {address
                ? "The network could not be read just now."
                : "The bounty wallet’s address has not been published yet."}
            </span>
          </>
        )}
        {address && (
          <>
            <code className="address">{address}</code>
            <div className="gauge-actions">
              <button className="text-button" onClick={read}>
                Read again
              </button>
              <a href={`https://explorer.solana.com/address/${address}`} target="_blank" rel="noreferrer">
                See it on Explorer
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
