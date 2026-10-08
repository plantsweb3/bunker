"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { RefreshCw, LockKeyhole } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { formatAmount, parseAmount, unhex } from "@/sdk/bytes";
import { chainTime, fetchVault, formatDuration } from "@/sdk/v3/chain";
import { authorizeAnnouncement, journalStatus, SignedAnnouncement } from "@/sdk/v3/journal";
import { DayKey, decryptDayKey, descriptorOf } from "@/sdk/v3/kit";
import {
  announceIx,
  closeProofIx,
  computeIx,
  decodeAnnounce,
  executeIx,
  expireIx,
  pendingPhase,
  stageIxs,
  VaultState,
} from "@/sdk/v3/protocol";
import { BIcon } from "../icon";
import { WalletButton, WalletProvider } from "../wallet";
import { FileField, Messages, NetworkPill, PasswordField, readKeyFile, useBunker } from "./shared";
/** How long a signed announcement has to land. Missing it is recoverable. */
const ANNOUNCE_WINDOW_SECS = 3600n;
type Loaded = { state: VaultState; spendable: bigint; now: bigint; at: number };
type Step = "idle" | "open" | "deposit" | "withdraw" | "review";
const sol = (lamports: bigint) => `${formatAmount(lamports, 9)} SOL`;
function App() {
  const b = useBunker();
  const [day, setDay] = useState<DayKey | null>(null);
  const [vault, setVault] = useState<Loaded | null>(null);
  const [wall, setWall] = useState(0);
  const [step, setStep] = useState<Step>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [fresh, setFresh] = useState(false);
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [ack, setAck] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setWall(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const load = useCallback(
    async (key: DayKey) => {
      if (!b.config?.programId) return null;
      const [v, now] = await Promise.all([
        fetchVault(b.connection, new PublicKey(b.config.programId), new PublicKey(key.vault)),
        chainTime(b.connection),
      ]);
      const loaded = { state: v.state, spendable: v.spendable, now, at: Date.now() };
      setVault(loaded);
      return loaded;
    },
    [b.config, b.connection],
  );
  // Chain time, advanced locally between reads. Display only; the program decides.
  const now = vault
    ? vault.now + BigInt(Math.floor(Math.max(0, wall - vault.at) / 1000))
    : 0n;
  const pending = vault?.state.pending ?? null;
  const phase = vault ? pendingPhase(vault.state, now) : "none";
  const stale = !!day && !!vault && BigInt(day.epoch) !== vault.state.epoch;
  const journal =
    day && vault && !stale && !pending
      ? journalStatus(day, vault.state)
      : ({ state: "unused" } as const);
  const unfinished = journal.state === "signed" ? journal.announcement : null;
  function close() {
    setStep("idle");
    setFile(null);
    setPassword("");
    setFresh(false);
    setAmount("");
    setRecipient("");
    setAck(false);
    b.setError("");
  }
  function seal() {
    setDay(null);
    setVault(null);
    close();
    b.setNotice("Bunker sealed. The day key is no longer in this browser tab.");
  }
  async function unseal() {
    const { c, program } = b.live();
    const key = await decryptDayKey(await readKeyFile(file), password);
    if (key.program !== program.toBase58() || key.genesis !== c.expectedGenesis)
      throw new Error("This day key belongs to a different network or program");
    const loaded = await load(key);
    if (!loaded) throw new Error("Configuration unavailable");
    if (BigInt(key.epoch) !== loaded.state.epoch)
      throw new Error(
        "This day key has been replaced. Use the newest one from the recovery tool.",
      );
    // This browser cannot know whether the key signed something elsewhere that
    // has not landed yet. The user has to say, every time it is opened.
    if (!fresh)
      throw new Error(
        "Confirm that this day key has not started a withdrawal on another device.",
      );
    setDay(key);
    close();
    b.setNotice("Unsealed. The day key is in this tab until you seal it.");
  }
  async function deposit() {
    const { payer } = b.live();
    if (!day) throw new Error("Open your Bunker first");
    const lamports = parseAmount(amount, 9);
    if (lamports <= 0n) throw new Error("Enter an amount");
    await b.transmit("Depositing", [
      SystemProgram.transfer({ fromPubkey: payer, toPubkey: new PublicKey(day.vault), lamports }),
    ]);
    close();
    await load(day);
    b.setNotice("Deposit confirmed.");
  }
  async function review() {
    if (!day || !vault) throw new Error("Open your Bunker first");
    const lamports = parseAmount(amount, 9);
    if (lamports <= 0n || lamports > vault.spendable)
      throw new Error(`Enter an amount up to ${sol(vault.spendable)}`);
    const to = new PublicKey(recipient);
    if (!PublicKey.isOnCurve(to.toBytes()) || to.toBase58() === day.vault)
      throw new Error("Use a normal wallet address outside this Bunker");
    setStep("review");
  }
  async function publish(signed: SignedAnnouncement) {
    const { program, payer } = b.live();
    if (!day || !vault) throw new Error("Open your Bunker first");
    const stages = stageIxs(program, payer, signed.message, signed.signature);
    for (let i = 0; i < stages.length; i++)
      await b.transmit(`Approval ${i + 1} of 3 · publishing your authorization`, [stages[i]]);
    await b.transmit("Approval 3 of 3 · announcing the withdrawal", [
      computeIx(),
      announceIx(program, payer, signed.payload, vault.state.opRoot),
      closeProofIx(program, payer, signed.message),
    ]);
    close();
    await load(day);
    b.setNotice(
      "Withdrawal announced. Nothing has moved. It can be released when the waiting period ends.",
    );
  }
  async function announce() {
    if (!day) throw new Error("Open your Bunker first");
    if (!ack) throw new Error("Confirm you checked the recipient and amount");
    const current = await load(day);
    if (!current) throw new Error("Configuration unavailable");
    if (BigInt(day.epoch) !== current.state.epoch)
      throw new Error("This day key has been replaced. Open the newest one.");
    const signed = await authorizeAnnouncement(
      day,
      unhex(day.seed),
      descriptorOf(day),
      current.state,
      {
        kind: 0,
        mint: PublicKey.default,
        destination: new PublicKey(recipient),
        amount: parseAmount(amount, 9),
        announceBy: current.now + ANNOUNCE_WINDOW_SECS,
      },
    );
    await publish(signed);
  }
  async function release() {
    const { program } = b.live();
    if (!day || !pending) throw new Error("Nothing to release");
    await b.transmit("Releasing", [executeIx(program, new PublicKey(day.vault), pending)]);
    await load(day);
    b.setNotice("Released. The withdrawal reached its destination.");
  }
  async function clearExpired() {
    const { program } = b.live();
    if (!day) throw new Error("Open your Bunker first");
    await b.transmit("Clearing", [expireIx(program, new PublicKey(day.vault))]);
    await load(day);
    b.setNotice("Expired withdrawal cleared. Nothing moved.");
  }
  const door = !b.config
    ? { state: "wait", label: "Connecting", line: "Reading the network." }
    : !b.enabled
      ? {
          state: "locked",
          label: "Locked until review",
          line: "A preview of the inside. Real funds stay out until the review is done.",
        }
      : !day || !vault
        ? {
            state: "sealed",
            label: "Sealed",
            line: "Nothing can be announced while it is sealed. Open it with your day key.",
          }
        : phase === "waiting"
          ? {
              state: "moving",
              label: "Waiting period",
              line: "A withdrawal has been announced. Nothing leaves until the wait is over.",
            }
          : phase === "open"
            ? {
                state: "moving",
                label: "Ready to release",
                line: "The waiting period is over. The withdrawal can be released.",
              }
            : {
                state: "open",
                label: "Unsealed",
                line: "The day key is in this tab. Seal it when you are done.",
              };
  const can = b.enabled && !!b.wallet.address && !b.busy;
  const unfinishedExpired = unfinished && now > decodeAnnounce(unfinished.payload).announceBy;
  return (
    <main className="vault-page">
      <div className="app-top">
        <div className="app-breadcrumb">
          <BIcon name="vault" size={18} />
          Vault
        </div>
        <div className="app-top-actions">
          <NetworkPill config={b.config} />
          <WalletButton />
        </div>
      </div>
      <div className={`vault-heading door-${door.state}`}>
        <div>
          <div className="eyebrow">MY BUNKER</div>
          <h1>Your Bunker.</h1>
          <p>{door.line}</p>
        </div>
        <div className="door-plate" aria-live="polite">
          <span className="door-light" aria-hidden="true" />
          <div>
            <span className="mono">DOOR</span>
            <strong>{door.label}</strong>
          </div>
          <dl>
            <div>
              <dt>Waiting period</dt>
              <dd>{vault ? formatDuration(BigInt(vault.state.delaySecs)) : "—"}</dd>
            </div>
            <div>
              <dt>Key generation</dt>
              <dd>{vault ? vault.state.epoch.toString() : "—"}</dd>
            </div>
            <div>
              <dt>Withdrawals announced</dt>
              <dd>{vault ? vault.state.opIndex.toString() : "—"}</dd>
            </div>
          </dl>
          <div className="door-actions">
            <button
              className="text-button"
              disabled={!!b.busy || !day}
              onClick={() => day && b.task("Refreshing", async () => void (await load(day)))}
            >
              <RefreshCw size={14} />
              Refresh
            </button>
            {day && (
              <button className="text-button" disabled={!!b.busy} onClick={seal}>
                <LockKeyhole size={14} />
                Seal Bunker
              </button>
            )}
          </div>
        </div>
      </div>
      {!b.config ? (
        <div className="notice">Loading release and network configuration…</div>
      ) : !b.enabled ? (
        <div className="release-gate">
          <BIcon name="review-pending" size={22} />
          <div>
            <h2>Built, tested, and locked until it is reviewed.</h2>
            <p>
              This is the app for the next protocol version: withdrawals wait,
              you can cancel them, and one recovery kit lasts for good. It
              runs today only against an isolated test network.
            </p>
            <Link href="/verify">View release requirements</Link>
          </div>
          <span className="pill">REVIEW PENDING</span>
        </div>
      ) : (
        <div className="notice">
          <BIcon name="simulation" size={18} />
          <span>Draft protocol on a test network. No real assets. No completed audit.</span>
        </div>
      )}
      <Messages busy={b.busy} error={b.error} notice={b.notice} />
      {stale && (
        <div className="error-box app-message" role="alert">
          This day key has been replaced by a recovery. Seal the Bunker and
          open the newest day key.
        </div>
      )}
      {day && vault ? (
        <>
          {pending && (
            <section className={`panel pending-panel phase-${phase}`}>
              <div className="pending-clock">
                <BIcon name={phase === "waiting" ? "waiting-period" : "withdraw"} size={30} />
                <div>
                  <span className="mono">
                    {phase === "waiting"
                      ? "LEAVES IN"
                      : phase === "open"
                        ? "READY · RELEASE WITHIN"
                        : "EXPIRED"}
                  </span>
                  <strong>
                    {phase === "waiting"
                      ? formatDuration(pending.opensAt - now)
                      : phase === "open"
                        ? formatDuration(pending.deadline - now)
                        : "Not released in time"}
                  </strong>
                </div>
              </div>
              <dl className="withdraw-review">
                <div>
                  <dt>Amount</dt>
                  <dd className="review-amount">{sol(pending.amount)}</dd>
                </div>
                <div>
                  <dt>To</dt>
                  <dd>
                    <code>{pending.destination.toBase58()}</code>
                  </dd>
                </div>
              </dl>
              <div className="actions">
                {phase === "open" && (
                  <button
                    className="button light"
                    disabled={!can}
                    onClick={() => b.task("Releasing", release)}
                  >
                    Release withdrawal
                  </button>
                )}
                {phase === "expired" && (
                  <button
                    className="button light"
                    disabled={!can}
                    onClick={() => b.task("Clearing", clearExpired)}
                  >
                    Clear expired withdrawal
                  </button>
                )}
                {phase !== "expired" && (
                  <Link className="button ghost" href="/recovery">
                    Not you? Cancel with your recovery kit
                  </Link>
                )}
              </div>
              <p className="micro">
                {phase === "waiting"
                  ? "Nothing has left your Bunker. Cancelling installs new keys and is done in the recovery tool."
                  : phase === "open"
                    ? "Anyone can submit the release; it can only go to the address above."
                    : "Nothing moved. Clear it to announce a new withdrawal."}
              </p>
            </section>
          )}
          {unfinished && (
            <section className="panel pending-panel">
              <h2>
                {unfinishedExpired
                  ? "An announcement ran out of time."
                  : "Finish announcing your withdrawal."}
              </h2>
              <p className="modal-copy">
                {unfinishedExpired
                  ? "This key signed a withdrawal that did not reach the network in time. It cannot sign again. Install new keys in the recovery tool to continue; your assets have not moved."
                  : `${sol(decodeAnnounce(unfinished.payload).amount)} to ${decodeAnnounce(unfinished.payload).destination.toBase58()} was signed but not announced. Finishing sends the same authorization.`}
              </p>
              <div className="actions">
                {!unfinishedExpired && (
                  <button
                    className="button light"
                    disabled={!can}
                    onClick={() => b.task("Announcing", () => publish(unfinished))}
                  >
                    Finish announcing
                  </button>
                )}
                <Link className="button ghost" href="/recovery">
                  Open the recovery tool
                </Link>
              </div>
            </section>
          )}
          {journal.state === "orphaned" && (
            <div className="error-box app-message" role="alert">
              This key was reserved for a withdrawal that was never saved. It
              will not sign again. Install new keys in the{" "}
              <Link href="/recovery">recovery tool</Link>; your assets have
              not moved.
            </div>
          )}
          <div className="vault-grid">
            <section className="panel balance-panel">
              <div className="panel-head">
                <span className="eyebrow">INSIDE</span>
                <BIcon name="vault" size={22} />
              </div>
              <span className="balance-label">Available · rent reserve excluded</span>
              <div className="vault-balance">
                {formatAmount(vault.spendable, 9)}
                <span>SOL</span>
              </div>
              <div className="vault-address">
                <span>Bunker address</span>
                <code>{day.vault}</code>
              </div>
              {step === "deposit" ? (
                <div className="inline-form">
                  <label className="field">
                    <span>Amount</span>
                    <input
                      inputMode="decimal"
                      placeholder="0.00"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </label>
                  <div className="actions">
                    <button
                      className="button light"
                      disabled={!can || !amount}
                      onClick={() => b.task("Depositing", deposit)}
                    >
                      Review deposit in wallet
                    </button>
                    <button className="button ghost" onClick={close}>
                      Back
                    </button>
                  </div>
                </div>
              ) : step === "withdraw" ? (
                <div className="inline-form">
                  <label className="field">
                    <span>Amount</span>
                    <input
                      inputMode="decimal"
                      placeholder="0.00"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>Recipient wallet address</span>
                    <input
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="Solana wallet address"
                      value={recipient}
                      onChange={(e) => setRecipient(e.target.value)}
                    />
                  </label>
                  <div className="actions">
                    <button
                      className="button light"
                      disabled={!can || !amount || !recipient}
                      onClick={() => b.task("Checking", review)}
                    >
                      Review withdrawal
                    </button>
                    <button className="button ghost" onClick={close}>
                      Back
                    </button>
                  </div>
                </div>
              ) : step === "review" ? (
                <div className="inline-form">
                  <dl className="withdraw-review">
                    <div>
                      <dt>You are announcing</dt>
                      <dd className="review-amount">{amount} SOL</dd>
                    </div>
                    <div>
                      <dt>To this address</dt>
                      <dd>
                        <code>{recipient}</code>
                      </dd>
                    </div>
                    <div>
                      <dt>It can leave after</dt>
                      <dd>
                        {formatDuration(BigInt(vault.state.delaySecs))} of
                        waiting, then within 7 days
                      </dd>
                    </div>
                    <div>
                      <dt>Until then</dt>
                      <dd>
                        Nothing moves, and your recovery kit can cancel it.
                      </dd>
                    </div>
                  </dl>
                  <label className="check-label">
                    <Checkbox checked={ack} onCheckedChange={(v) => setAck(v === true)} />
                    <span>
                      I checked the full recipient and amount. Expect 3 wallet
                      approvals.
                    </span>
                  </label>
                  <div className="actions">
                    <button
                      className="button light"
                      disabled={!can || !ack}
                      onClick={() => b.task("Signing", announce)}
                    >
                      Sign and announce
                    </button>
                    <button className="button ghost" onClick={() => setStep("withdraw")}>
                      Back
                    </button>
                  </div>
                </div>
              ) : (
                <div className="actions">
                  <button
                    className="button light"
                    disabled={!can}
                    onClick={() => {
                      close();
                      setStep("deposit");
                    }}
                  >
                    <BIcon name="deposit" size={17} />
                    Deposit
                  </button>
                  <button
                    className="button ghost"
                    disabled={!can || !!pending || stale || journal.state !== "unused"}
                    onClick={() => {
                      close();
                      setStep("withdraw");
                    }}
                  >
                    <BIcon name="withdraw" size={17} />
                    Withdraw
                  </button>
                </div>
              )}
            </section>
            <aside className="panel authority-panel">
              <div className="panel-head">
                <h2>Two files, two jobs</h2>
                <BIcon name="bunker-key" size={20} />
              </div>
              <div className="metric">
                <span>Day key · in this tab</span>
                <b>Announces withdrawals</b>
              </div>
              <div className="metric">
                <span>Recovery kit · kept away</span>
                <b>Cancels and replaces keys</b>
              </div>
              <div className="metric">
                <span>Connected wallet</span>
                <b>Pays fees only</b>
              </div>
              <div className="metric">
                <span>Independent review</span>
                <b className="amber">Pending</b>
              </div>
              <Link className="security-link" href="/recovery">
                <BIcon name="recovery-kit" size={16} />
                Open the recovery tool
              </Link>
            </aside>
          </div>
        </>
      ) : (
        <div className="vault-grid">
          <section className="panel balance-panel">
            <div className="panel-head">
              <span className="eyebrow">BUNKER OVERVIEW</span>
              <BIcon name="vault" size={22} />
            </div>
            {step === "open" ? (
              <div className="inline-form">
                <h2>Open with your day key.</h2>
                <FileField label="Day key" onFile={setFile} disabled={!!b.busy} />
                <PasswordField label="Day key password" value={password} onChange={setPassword} />
                <label className="check-label">
                  <Checkbox checked={fresh} onCheckedChange={(v) => setFresh(v === true)} />
                  <span>
                    This day key has not started a withdrawal on another
                    device or browser. If unsure, install new keys in the
                    recovery tool first.
                  </span>
                </label>
                <div className="actions">
                  <button
                    className="button light"
                    disabled={!can || !file || !fresh || password.length < 12}
                    onClick={() => b.task("Opening", unseal)}
                  >
                    Unseal Bunker
                  </button>
                  <button className="button ghost" onClick={close}>
                    Back
                  </button>
                </div>
              </div>
            ) : (
              <>
                <h2>{b.enabled ? "The door is sealed." : "A separate home for your assets."}</h2>
                <p>
                  {b.enabled
                    ? "Open your Bunker with its day key, or build a new one in the recovery tool."
                    : "Deposits go in from any wallet. Withdrawals wait, and you can cancel them."}
                </p>
                <div className="actions">
                  {b.enabled ? (
                    <Link className="button light" href="/recovery">
                      <BIcon name="vault" size={17} />
                      Build a Bunker
                    </Link>
                  ) : (
                    <button className="button light" disabled>
                      <BIcon name="vault" size={17} />
                      Create Bunker
                    </button>
                  )}
                  <button
                    className="button ghost"
                    disabled={!can}
                    onClick={() => {
                      close();
                      setStep("open");
                    }}
                  >
                    <BIcon name="bunker-key" size={17} />
                    Open with day key
                  </button>
                </div>
                <span className="micro">
                  {b.enabled
                    ? "TEST ASSETS ONLY · DRAFT PROTOCOL"
                    : "REAL-FUND CUSTODY OPENS AFTER EXTERNAL REVIEW"}
                </span>
              </>
            )}
          </section>
          <aside className="panel authority-panel">
            <div className="panel-head">
              <h2>How a withdrawal leaves</h2>
              <BIcon name="waiting-period" size={20} />
            </div>
            <ol className="leave-steps">
              <li>
                <BIcon name="bunker-key" size={18} />
                <div>
                  <b>Announce</b>
                  <span>Your day key signs the exact amount and address.</span>
                </div>
              </li>
              <li>
                <BIcon name="waiting-period" size={18} />
                <div>
                  <b>Wait</b>
                  <span>At least 24 hours. Nothing moves.</span>
                </div>
              </li>
              <li>
                <BIcon name="alert" size={18} />
                <div>
                  <b>Cancel if it wasn’t you</b>
                  <span>Your recovery kit installs new keys.</span>
                </div>
              </li>
              <li>
                <BIcon name="withdraw" size={18} />
                <div>
                  <b>Release</b>
                  <span>Only to the announced address, only once.</span>
                </div>
              </li>
            </ol>
          </aside>
        </div>
      )}
      <div className="workspace-bottom">
        <div>
          <LockKeyhole size={17} />
          <span>
            The day key stays in this tab until you seal it. The recovery kit
            is never opened on this page.
          </span>
        </div>
        <Link href="/demo">Explore the no-wallet demo</Link>
      </div>
    </main>
  );
}
export default function Vault3App() {
  return (
    <WalletProvider>
      <App />
    </WalletProvider>
  );
}
