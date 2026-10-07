"use client";
import "@/sdk/polyfill";
import { useState } from "react";
import Link from "next/link";
import { PublicKey } from "@solana/web3.js";
import {
  Search,
  LoaderCircle,
  TriangleAlert,
  Shield,
  Eye,
  Check,
  Minus,
} from "lucide-react";
import { useHydrated } from "./use-hydrated";
import { createConnection } from "@/sdk/client";
import { TOKEN_PROGRAM_ID } from "@/sdk/classic-token";
import { formatAmount } from "@/sdk/bytes";
import {
  Exposure,
  ParsedTokenInfo,
  TokenHolding,
  TOKEN_2022_PROGRAM_ID,
  summarizeExposure,
} from "@/sdk/exposure";
const SHOWN = 8;
const brief = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;
const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
function problem(e: unknown) {
  const m = e instanceof Error ? e.message : "";
  if (/429|Too many requests/i.test(m))
    return "The Solana connection is busy. Wait a few seconds and try again.";
  if (/503|RPC unavailable|fetch failed|Failed to fetch/i.test(m))
    return "The Solana connection is unavailable. Try again in a moment.";
  return "This wallet could not be read. Try again in a moment.";
}
export default function ExposureCheck() {
  const ready = useHydrated();
  const [connection] = useState(createConnection);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{
    address: string;
    exposure: Exposure;
  } | null>(null);
  async function check() {
    let owner: PublicKey;
    try {
      owner = new PublicKey(input.trim());
    } catch {
      setResult(null);
      setError("That is not a valid Solana address. Paste the full address.");
      return;
    }
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const rows = (program: PublicKey) =>
        connection
          .getParsedTokenAccountsByOwner(owner, { programId: program })
          .then((r) =>
            r.value.map((t) => ({
              account: t.pubkey.toBase58(),
              info: t.account.data.parsed?.info as ParsedTokenInfo,
            })),
          );
      const [lamports, classic, token2022] = await Promise.all([
        connection.getBalance(owner),
        rows(TOKEN_PROGRAM_ID),
        rows(new PublicKey(TOKEN_2022_PROGRAM_ID)),
      ]);
      setResult({
        address: owner.toBase58(),
        exposure: summarizeExposure(lamports, classic, token2022),
      });
    } catch (e) {
      setError(problem(e));
    } finally {
      setBusy(false);
    }
  }
  const e = result?.exposure;
  const nothing = e && e.lamports === 0n && e.movable.length === 0;
  return (
    <div className="check-wrap">
      <div className="page-heading">
        <div>
          <div className="eyebrow">CHECK A WALLET</div>
          <h1>
            What could one signature
            <br />
            <span className="ice">take from this wallet?</span>
          </h1>
          <p>
            Paste any Solana address. Nothing to connect, nothing to sign. This
            reads public balances and open token approvals.
          </p>
        </div>
        <span className="pill">
          <Eye size={14} />
          READ-ONLY · MAINNET
        </span>
      </div>
      <form
        className="check-form"
        onSubmit={(event) => {
          event.preventDefault();
          void check();
        }}
      >
        <label className="field">
          <span>Solana wallet address</span>
          <input
            aria-label="Solana wallet address"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="Paste a wallet address"
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
        </label>
        <button
          className="button light"
          disabled={!ready || busy || !input.trim()}
        >
          {busy ? (
            <LoaderCircle size={15} className="spin" />
          ) : (
            <Search size={15} />
          )}
          {busy ? "Reading the chain" : "Check wallet"}
        </button>
      </form>
      {error && (
        <div role="alert" className="error-box app-message">
          {error}
        </div>
      )}
      {result && e && (
        <div className="check-result" aria-live="polite">
          <div className="check-address">
            <span className="mono">WALLET</span>
            <code>{result.address}</code>
          </div>
          {nothing ? (
            <div className="check-empty">
              <Shield size={24} />
              <h2>Nothing here to take.</h2>
              <p>
                This address holds no SOL and no tokens that a signature could
                move right now.
              </p>
            </div>
          ) : (
            <>
              <div className="check-grid">
                <section className="check-card exposed">
                  <span className="mono">ONE SIGNATURE CAN MOVE</span>
                  <strong>
                    {formatAmount(e.lamports, 9)} <small>SOL</small>
                  </strong>
                  <p>
                    plus {plural(e.movable.length, "token balance")}. If this
                    wallet approves a drainer’s transaction, or its seed phrase
                    leaks, all of it can leave in one transaction.
                  </p>
                </section>
                <section
                  className={`check-card ${e.approvals.length ? "warn" : ""}`}
                >
                  <span className="mono">ALREADY APPROVED TO SOMEONE ELSE</span>
                  <strong>{e.approvals.length}</strong>
                  <p>
                    {e.approvals.length
                      ? `${plural(e.approvals.length, "token account has", "token accounts have")} an open approval. That address can move those tokens without asking this wallet again.`
                      : "No open token approvals. No other address can move this wallet’s tokens without a new signature."}
                  </p>
                </section>
                <section className="check-card safe">
                  <span className="mono">A BUNKER IS BUILT TO HOLD</span>
                  <strong>
                    {e.supported.length + (e.lamports > 0n ? 1 : 0)}
                    <small> of {e.movable.length + (e.lamports > 0n ? 1 : 0)}</small>
                  </strong>
                  <p>
                    SOL and classic SPL tokens.{" "}
                    {e.unsupported.length
                      ? `${plural(e.unsupported.length, "Token-2022 balance")} here is not supported.`
                      : "Everything movable here is a supported type."}{" "}
                    Real funds are not accepted yet.
                  </p>
                </section>
              </div>
              {e.approvals.length > 0 && (
                <div className="check-table">
                  <h2>Open approvals</h2>
                  <p>
                    Revoke any you do not recognise from your wallet or a
                    revoke tool you trust. Bunker never asks you to approve
                    anything to do this.
                  </p>
                  <Holdings rows={e.approvals} approvals />
                </div>
              )}
              {e.movable.length > 0 && (
                <div className="check-table">
                  <h2>Token balances a signature can move</h2>
                  <Holdings rows={e.movable} />
                </div>
              )}
            </>
          )}
          <p className="check-foot">
            {e.frozen > 0 && `${plural(e.frozen, "frozen balance")} excluded. `}
            {e.emptyAccounts > 0 &&
              `${plural(e.emptyAccounts, "empty token account")} ignored. `}
            Token names and prices are not shown because they can be spoofed;
            mints are shown instead. NFTs with custom programs, staked SOL and
            positions inside other protocols are not included.
          </p>
        </div>
      )}
      <div className="check-notes">
        <div>
          <TriangleAlert size={17} />
          <p>
            <strong>What this is.</strong> An inventory of public chain data,
            read through Bunker’s RPC connection. The address is sent to that
            RPC provider and is not stored by this site.
          </p>
        </div>
        <div>
          <Shield size={17} />
          <p>
            <strong>What it is not.</strong> A security scan. It cannot see
            malware, a leaked seed phrase, or approvals inside other programs.{" "}
            <Link href="/security">Read what Bunker does and doesn’t stop.</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
function Holdings({
  rows,
  approvals = false,
}: {
  rows: TokenHolding[];
  approvals?: boolean;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, SHOWN);
  return (
    <>
      <ul className="holding-list">
        {shown.map((t) => (
          <li key={t.account}>
            <div>
              <code title={t.mint}>{brief(t.mint)}</code>
              <span>
                {t.program === "classic" ? "Classic SPL" : "Token-2022"}
              </span>
            </div>
            {approvals ? (
              <div className="holding-approval">
                <span>
                  {formatAmount(t.delegatedAmount, t.decimals)} approved to
                </span>
                <code title={t.delegate ?? ""}>{brief(t.delegate ?? "")}</code>
              </div>
            ) : (
              <span className="holding-support">
                {t.program === "classic" ? (
                  <>
                    <Check size={13} /> Supported
                  </>
                ) : (
                  <>
                    <Minus size={13} /> Not supported
                  </>
                )}
              </span>
            )}
            <b>{formatAmount(t.amount, t.decimals)}</b>
          </li>
        ))}
      </ul>
      {rows.length > SHOWN && (
        <button className="text-button" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      )}
    </>
  );
}
