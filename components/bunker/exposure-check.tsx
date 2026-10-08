"use client";
import "@/sdk/polyfill";
import { useEffect, useRef, useState } from "react";
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
  Link2,
  KeyRound,
  ArrowRight,
} from "lucide-react";
import { useHydrated } from "./use-hydrated";
import { createConnection } from "@/sdk/client";
import { TOKEN_PROGRAM_ID } from "@/sdk/classic-token";
import { formatAmount } from "@/sdk/bytes";
import { mintLabel } from "@/sdk/known-mints";
import {
  Exposure,
  ParsedTokenInfo,
  permanentDelegate,
  RAW_TOKEN_BYTES,
  rawTokenInfo,
  TokenHolding,
  TOKEN_2022_PROGRAM_ID,
  summarizeExposure,
} from "@/sdk/exposure";
/** How many Token-2022 mints are looked up for issuer powers (100 per request). */
const MINT_LOOKUPS = 300;
class TooLarge extends Error {}
/** A non-empty balance's amount in the token's units, when they are known. */
const amountText = (amount: bigint, decimals: number | null) =>
  decimals === null ? "amount not loaded" : formatAmount(amount, decimals);
const SHOWN = 8;
const brief = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;
const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
function problem(e: unknown) {
  const m = e instanceof Error ? e.message : "";
  if (e instanceof TooLarge)
    return "This wallet has more token accounts than this check can read. Its SOL balance and tokens can still be moved by one signature.";
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
  const [copied, setCopied] = useState(false);
  const started = useRef(false);
  useEffect(() => {
    // A shared or submitted link carries the address as ?a=.
    const a = new URLSearchParams(window.location.search).get("a");
    if (!a || started.current) return;
    started.current = true;
    setInput(a);
    void check(a);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function check(address = input) {
    let owner: PublicKey;
    setCopied(false);
    try {
      owner = new PublicKey(address.trim());
    } catch {
      setResult(null);
      setError("That is not a valid Solana address. Paste the full address.");
      return;
    }
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const tooLarge = (e: unknown) => /502|too large/i.test(e instanceof Error ? e.message : "");
      // Fully parsed first. A wallet with thousands of token accounts is too
      // large to read that way, so it is read again as the first bytes of each
      // account, which is enough to count and classify but not to show amounts.
      const rows = (program: PublicKey) =>
        connection
          .getParsedTokenAccountsByOwner(owner, { programId: program })
          .then((r) =>
            r.value.map((t) => ({
              account: t.pubkey.toBase58(),
              info: t.account.data.parsed?.info as ParsedTokenInfo,
            })),
          )
          .catch(async (e) => {
            if (!tooLarge(e)) throw e;
            const raw = await connection
              .getTokenAccountsByOwner(owner, { programId: program }, {
                dataSlice: { offset: 0, length: RAW_TOKEN_BYTES },
              } as Parameters<typeof connection.getTokenAccountsByOwner>[2])
              .catch((again) => {
                throw tooLarge(again) ? new TooLarge() : again;
              });
            return raw.value.flatMap((t) => {
              const info = rawTokenInfo(t.account.data, (b) => new PublicKey(b).toBase58());
              return info ? [{ account: t.pubkey.toBase58(), info: info as ParsedTokenInfo }] : [];
            });
          });
      const [lamports, classic, token2022] = await Promise.all([
        connection.getBalance(owner),
        rows(TOKEN_PROGRAM_ID),
        rows(new PublicKey(TOKEN_2022_PROGRAM_ID)),
      ]);
      // Token-2022 lets an issuer keep the power to move holders' tokens. That
      // is recorded on the mint, so the mints of the balances held are read.
      const mints = [
        ...new Set(token2022.filter((t) => /^[1-9]/.test(t.info?.tokenAmount?.amount ?? "")).map((t) => t.info.mint)),
      ].slice(0, MINT_LOOKUPS);
      const issuers = new Map<string, string>();
      for (let i = 0; i < mints.length; i += 100) {
        const batch = mints.slice(i, i + 100);
        const found = await connection.getMultipleParsedAccounts(batch.map((m) => new PublicKey(m)));
        found.value.forEach((account, at) => {
          const data = account?.data;
          const delegate = data && "parsed" in data ? permanentDelegate(data.parsed?.info) : null;
          if (delegate) issuers.set(batch[at], delegate);
        });
      }
      setResult({
        address: owner.toBase58(),
        exposure: summarizeExposure(lamports, classic, token2022, issuers),
      });
      window.history.replaceState(null, "", `/check?a=${owner.toBase58()}`);
    } catch (e) {
      setError(problem(e));
    } finally {
      setBusy(false);
    }
  }
  const e = result?.exposure;
  const nothing = e && e.lamports === 0n && e.movable.length === 0;
  const kinds = e ? e.movable.length + (e.lamports > 0n ? 1 : 0) : 0;
  const held = e ? e.supported.length + (e.lamports > 0n ? 1 : 0) : 0;
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
            <button
              className="text-button"
              onClick={() =>
                navigator.clipboard
                  .writeText(window.location.href)
                  .then(() => setCopied(true))
                  .catch(() => {})
              }
            >
              <Link2 size={14} />
              {copied ? "Link copied" : "Copy link to this result"}
            </button>
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
              <h2 className="check-verdict">
                One signature moves{" "}
                <span className="ice">
                  {kinds === 1 ? "everything" : `all ${kinds} balances`}
                </span>{" "}
                in this wallet.
              </h2>
              <div className="check-compare">
                <div className="compare-row today">
                  <span className="mono">TODAY</span>
                  <div className="compare-key">
                    <KeyRound size={15} />
                    Wallet key
                  </div>
                  <ArrowRight size={15} />
                  <div className="compare-target">
                    {formatAmount(e.lamports, 9)} SOL
                    {e.movable.length > 0 &&
                      ` + ${plural(e.movable.length, "token balance")}`}
                  </div>
                </div>
                <div className="compare-row bunkered">
                  <span className="mono">WITH A BUNKER</span>
                  <div className="compare-key">
                    <KeyRound size={15} />
                    Wallet key
                  </div>
                  <ArrowRight size={15} />
                  <div className="compare-target">
                    Only what you leave out for spending
                  </div>
                  <span aria-hidden="true" />
                  <div className="compare-key ice">
                    <Shield size={15} />
                    Bunker key
                  </div>
                  <ArrowRight size={15} />
                  <div className="compare-target">
                    Everything else: {held} of {kinds} balances here can go
                    in
                  </div>
                </div>
                <p>
                  Design goal, not a guarantee, and not open for real funds
                  yet. <Link href="/#limits">Where the protection stops.</Link>
                </p>
              </div>
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
                      : "No open approvals on the token accounts this check can read. It cannot see what a wallet may sign next."}
                  </p>
                </section>
                <section className="check-card safe">
                  <span className="mono">A BUNKER IS BUILT TO HOLD</span>
                  <strong>
                    {held}
                    <small> of {kinds}</small>
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
              {e.issuerMovable.length > 0 && (
                <div className="check-table">
                  <h2>Balances the token’s issuer can move</h2>
                  <p>
                    {plural(e.issuerMovable.length, "token here was", "tokens here were")}{" "}
                    created with a permanent delegate: an address chosen by the
                    issuer that can move or burn the balance at any time,
                    without this wallet signing anything. No wallet or vault
                    can prevent that. Treat such a balance as held at the
                    issuer’s discretion.
                  </p>
                  <Holdings rows={e.issuerMovable} issuer />
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
            {e.movable.some((t) => t.decimals === null) &&
              "This wallet has too many token accounts to load amounts for; the counts are complete. "}
            Token-2022 balances are checked for a permanent delegate only: a
            token can also be frozen by its issuer, or carry transfer fees or
            hooks, and this does not report those. Only a short list of
            well-known tokens is named, matched by mint
            address; other names and all prices are left out because they can
            be spoofed. NFTs with custom programs, staked SOL and
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
  issuer = false,
}: {
  rows: TokenHolding[];
  approvals?: boolean;
  issuer?: boolean;
}) {
  const [all, setAll] = useState(false);
  const ordered = [
    ...rows.filter((t) => mintLabel(t.mint)),
    ...rows.filter((t) => !mintLabel(t.mint)),
  ];
  const shown = all ? ordered : ordered.slice(0, SHOWN);
  return (
    <>
      <ul className="holding-list">
        {shown.map((t) => (
          <li key={t.account}>
            <div>
              {mintLabel(t.mint) && <strong>{mintLabel(t.mint)}</strong>}
              <code title={t.mint}>{brief(t.mint)}</code>
              <span>
                {t.program === "classic" ? "Classic SPL" : "Token-2022"}
              </span>
            </div>
            {approvals ? (
              <div className="holding-approval">
                <span>
                  {t.decimals === null ? "Approved to" : `${formatAmount(t.delegatedAmount, t.decimals)} approved to`}
                </span>
                <code title={t.delegate ?? ""}>{brief(t.delegate ?? "")}</code>
              </div>
            ) : issuer ? (
              <div className="holding-approval">
                <span>Movable by</span>
                <code title={t.issuer ?? ""}>{brief(t.issuer ?? "")}</code>
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
            <b>{amountText(t.amount, t.decimals)}</b>
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
