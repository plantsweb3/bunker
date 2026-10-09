"use client";
// A read-only gauge of one wallet's SOL balance, drawn as a round vault door
// with a ring of segments. It reads through the site's own RPC route and
// shows a number only when that read succeeded: no cached figure, no
// placeholder. Pass `goal` to make the ring a measure against a target; with
// no goal the ring is simply lit when the balance has been read. Whatever is
// passed as children (a clip, a still) is shown inside the door, and is dimmed
// until a balance has been read, so that a picture of a full vault is never
// the only thing on screen.
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { curveRewards, exchangeRewards, type RawAccount, type RewardAccounts } from "@/lib/creator-rewards";

const SEGMENTS = 34;
const REFRESH_MS = 30_000;
type Reading =
  | { state: "reading" }
  /** `unclaimed` is null when the reward accounts could not be read with certainty. */
  | { state: "read"; wallet: number; unclaimed: number | null; at: Date }
  | { state: "unavailable" };

async function ask<T>(method: string, params: unknown[]): Promise<T> {
  const r = await fetch("/api/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    cache: "no-store",
  });
  const body = (await r.json()) as { result?: T };
  if (!r.ok || body.result === undefined || body.result === null) throw new Error("No answer");
  return body.result;
}
const lamportsOk = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
/** The wallet's balance, and with reward accounts, what has been earned and
 * not claimed. A wallet read that fails is a failure; a reward read that
 * cannot be trusted leaves that part out and says so by returning null. */
async function readVault(address: string, rewards?: RewardAccounts) {
  if (!rewards) {
    const { value } = await ask<{ value: unknown }>("getBalance", [address, { commitment: "confirmed" }]);
    if (!lamportsOk(value)) throw new Error("No balance in the answer");
    return { wallet: value / 1e9, unclaimed: null };
  }
  const [accounts, rent] = await Promise.all([
    ask<{ value: RawAccount[] }>("getMultipleAccounts", [
      [address, rewards.curveVault, rewards.exchangeVault],
      { commitment: "confirmed", encoding: "base64" },
    ]),
    ask<unknown>("getMinimumBalanceForRentExemption", [0]).catch(() => null),
  ]);
  if (!Array.isArray(accounts.value) || accounts.value.length !== 3) throw new Error("Unexpected answer");
  const [wallet, curve, exchange] = accounts.value;
  const held = wallet === null ? 0 : wallet.lamports;
  if (!lamportsOk(held)) throw new Error("No balance in the answer");
  const onCurve = lamportsOk(rent) ? curveRewards(curve, rent) : null;
  const onExchange = exchangeRewards(exchange, rewards);
  return {
    wallet: held / 1e9,
    unclaimed: onCurve === null || onExchange === null ? null : (onCurve + onExchange) / 1e9,
  };
}
const sol = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 3 });

export default function VaultGauge({
  address,
  goal,
  label = "In the vault",
  note,
  rewards,
  children,
}: {
  address: string | null;
  /** Where the wallet's unclaimed creator rewards sit. With these, the figure
   * is the wallet plus what it has earned and not yet claimed. */
  rewards?: RewardAccounts;
  /** A target in SOL. Optional. */
  goal?: number;
  label?: string;
  /** A line under the reading, for saying what the picture is and is not. */
  note?: string;
  children?: ReactNode;
}) {
  const [reading, setReading] = useState<Reading>(address ? { state: "reading" } : { state: "unavailable" });
  const read = useCallback(() => {
    if (!address) return;
    readVault(address, rewards).then(
      (r) => setReading({ state: "read", ...r, at: new Date() }),
      () => setReading({ state: "unavailable" }),
    );
  }, [address, rewards]);
  useEffect(() => {
    read();
    const timer = setInterval(() => document.visibilityState === "visible" && read(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [read]);

  const total = reading.state === "read" ? reading.wallet + (reading.unclaimed ?? 0) : 0;
  const lit = reading.state !== "read" ? 0 : goal ? Math.round(Math.min(1, total / goal) * SEGMENTS) : SEGMENTS;
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
              {sol(total)}
              <i>SOL</i>
            </strong>
            {reading.unclaimed !== null && (
              <span className="gauge-split">
                <b>{sol(reading.wallet)}</b> in the wallet
                <br />
                <b>{sol(reading.unclaimed)}</b> creator rewards earned, not yet claimed
              </span>
            )}
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
        {note && <span className="micro gauge-note">{note}</span>}
      </div>
    </div>
  );
}
