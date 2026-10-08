"use client";
import { useState } from "react";
import Link from "next/link";
import { PublicKey } from "@solana/web3.js";
import { Check } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { hex, unhex } from "@/sdk/bytes";
import { genesisAuthorities, recoveryPacket } from "@/sdk/v3/authority";
import { epochSeed } from "@/sdk/v3/derive";
import { fetchVault, formatDuration } from "@/sdk/v3/chain";
import {
  ArchivalKit,
  DayKey,
  decryptArchival,
  descriptorOf,
  download,
  encryptFile,
  fileName,
  validateArchival,
} from "@/sdk/v3/kit";
import {
  closeProofIx,
  computeIx,
  initializeIx,
  recoverIx,
  stageIxs,
  vaultAddress,
  VaultState,
} from "@/sdk/v3/protocol";
import { BIcon } from "../icon";
import { WalletButton, WalletProvider } from "../wallet";
import { FileField, Messages, NetworkPill, PasswordField, readKeyFile, useBunker } from "./shared";
const DELAYS = [
  [3_600, "1 hour"],
  [86_400, "24 hours"],
  [259_200, "3 days"],
  [604_800, "7 days"],
] as const;
const delayLabel = (secs: number) =>
  DELAYS.find(([s]) => s === secs)?.[1] ?? formatDuration(BigInt(secs));
function dayKeyFor(kit: ArchivalKit, epoch: bigint): DayKey {
  const { delaySecs: _delay, master, kind: _kind, ...identity } = kit;
  void _delay;
  void _kind;
  return {
    ...identity,
    kind: "day-key",
    epoch: epoch.toString(),
    seed: hex(epochSeed(unhex(master), descriptorOf(kit), epoch)),
  };
}
function Tool() {
  const b = useBunker();
  const [mode, setMode] = useState<"create" | "recover">("create");
  // create
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  // Off unless the user turns it on and acknowledges what it means.
  const [wait, setWait] = useState(false);
  const [delay, setDelay] = useState<number>(86_400);
  const [waitAck, setWaitAck] = useState(false);
  const [ack, setAck] = useState(false);
  const [draft, setDraft] = useState<{ kit: ArchivalKit; encrypted: string } | null>(null);
  const [verified, setVerified] = useState("");
  const [created, setCreated] = useState<ArchivalKit | null>(null);
  // recover
  const [file, setFile] = useState<File | null>(null);
  const [opened, setOpened] = useState<{ kit: ArchivalKit; chain: VaultState } | null>(null);
  const [recovered, setRecovered] = useState<bigint | null>(null);
  const reset = (next: "create" | "recover") => {
    setMode(next);
    setPassword("");
    setRepeat("");
    setAck(false);
    setWait(false);
    setWaitAck(false);
    setDraft(null);
    setVerified("");
    setCreated(null);
    setFile(null);
    setOpened(null);
    setRecovered(null);
    b.setError("");
    b.setNotice("");
  };
  async function giveDayKey(kit: ArchivalKit, epoch: bigint) {
    const day = dayKeyFor(kit, epoch);
    download(fileName(day), await encryptFile(day, password));
  }
  async function makeKit() {
    const { c, program } = b.live();
    if (password !== repeat) throw new Error("Passwords do not match");
    if (!ack) throw new Error("Acknowledge what the recovery kit is");
    if (wait && !waitAck)
      throw new Error("Acknowledge the waiting period, or turn it off");
    const vaultId = crypto.getRandomValues(new Uint8Array(32));
    const master = crypto.getRandomValues(new Uint8Array(32));
    // Canonical field order, so the re-opened file compares equal.
    const kit: ArchivalKit = validateArchival({
      version: 3,
      kind: "archival",
      network: c.network as "devnet" | "localnet",
      genesis: c.expectedGenesis,
      program: program.toBase58(),
      vaultId: hex(vaultId),
      vault: vaultAddress(program, vaultId).toBase58(),
      delaySecs: wait ? delay : 0,
      master: hex(master),
    });
    master.fill(0);
    const encrypted = await encryptFile(kit, password);
    setDraft({ kit, encrypted });
    setVerified("");
    download(fileName(kit), encrypted);
  }
  async function verify(f: File) {
    if (!draft) return;
    const reopened = await decryptArchival(await readKeyFile(f), password);
    if (JSON.stringify(reopened) !== JSON.stringify(draft.kit))
      throw new Error("Choose the recovery kit that was just downloaded");
    setVerified(f.name);
  }
  async function create() {
    const { program, payer } = b.live();
    if (!draft || !verified) throw new Error("Re-open the saved recovery kit first");
    const d = descriptorOf(draft.kit);
    const g = genesisAuthorities(unhex(draft.kit.master), d);
    await b.transmit("Building your Bunker", [
      initializeIx(program, payer, {
        vaultId: d.vaultId,
        chainTag: d.chainTag,
        opRoot: g.opRoot,
        recRoot: g.recRoot,
        delaySecs: draft.kit.delaySecs,
      }),
    ]);
    await giveDayKey(draft.kit, 0n);
    setCreated(draft.kit);
    setDraft(null);
    b.setNotice("Bunker built. Your first day key was downloaded.");
  }
  async function open() {
    const { c, program } = b.live();
    const kit = await decryptArchival(await readKeyFile(file), password);
    if (kit.program !== program.toBase58() || kit.genesis !== c.expectedGenesis)
      throw new Error("This recovery kit belongs to a different network or program");
    const { state } = await fetchVault(b.connection, program, new PublicKey(kit.vault));
    setOpened({ kit, chain: state });
    setRecovered(null);
  }
  async function recover() {
    const { program, payer } = b.live();
    if (!opened) throw new Error("Open your recovery kit first");
    const { kit } = opened;
    // Read the epoch again: the packet is fixed by it and nothing else.
    const { state } = await fetchVault(b.connection, program, new PublicKey(kit.vault));
    const packet = recoveryPacket(unhex(kit.master), descriptorOf(kit), state.epoch);
    const stages = stageIxs(program, payer, packet.message, packet.signature);
    for (let i = 0; i < stages.length; i++)
      await b.transmit(`Approval ${i + 1} of 3 · publishing the recovery packet`, [stages[i]]);
    await b.transmit("Approval 3 of 3 · installing new keys", [
      computeIx(),
      recoverIx(program, payer, packet.payload, state),
      closeProofIx(program, payer, packet.message),
    ]);
    await giveDayKey(kit, state.epoch + 1n);
    const after = await fetchVault(b.connection, program, new PublicKey(kit.vault));
    setOpened({ kit, chain: after.state });
    setRecovered(after.state.epoch);
    b.setNotice(
      "Recovered. Every earlier day key is dead, any pending withdrawal was cancelled, and a new day key was downloaded.",
    );
  }
  const pending = opened?.chain.pending;
  return (
    <main className="vault-page recovery-page">
      <div className="app-top">
        <div className="app-breadcrumb">
          <BIcon name="recovery-kit" size={18} />
          Recovery tool
        </div>
        <div className="app-top-actions">
          <NetworkPill config={b.config} />
          <WalletButton />
        </div>
      </div>
      <div className="vault-heading">
        <div>
          <div className="eyebrow">THE ONLY PLACE THE RECOVERY KIT IS OPENED</div>
          <h1>Recovery tool.</h1>
          <p>
            Build a Bunker, cancel a withdrawal, or replace a lost or exposed
            day key. Everything here uses your recovery kit; the vault page
            never does.
          </p>
        </div>
      </div>
      {!b.config ? (
        <div className="notice">Loading network configuration…</div>
      ) : !b.enabled ? (
        <div className="release-gate">
          <BIcon name="review-pending" size={22} />
          <div>
            <h2>Not available in this release.</h2>
            <p>
              The recovery tool belongs to the next protocol version, which is
              a draft under review. It runs only against an isolated test
              network.
            </p>
            <Link href="/verify">View release requirements</Link>
          </div>
          <span className="pill">DRAFT</span>
        </div>
      ) : (
        <div className="notice">
          <BIcon name="simulation" size={18} />
          <span>
            Draft protocol on a test network. No real assets. In a real
            release this tool would run offline, away from your browser.
          </span>
        </div>
      )}
      <Messages busy={b.busy} error={b.error} notice={b.notice} />
      <div className="tool-tabs" role="tablist">
        <button role="tab" aria-selected={mode === "create"} onClick={() => reset("create")}>
          Build a new Bunker
        </button>
        <button role="tab" aria-selected={mode === "recover"} onClick={() => reset("recover")}>
          Recover or cancel
        </button>
      </div>
      {mode === "create" ? (
        <section className="panel tool-panel">
          {created ? (
            <>
              <h2>Your Bunker is built.</h2>
              <ol className="tool-steps">
                <li>
                  <strong>Recovery kit</strong> — move it off this device now.
                  It never changes and you will rarely need it.
                </li>
                <li>
                  <strong>Day key</strong> — this is what opens your Bunker for
                  withdrawals. If it is lost or stolen, the recovery kit
                  replaces it.
                </li>
              </ol>
              <div className="vault-address">
                <span>Bunker address</span>
                <code>{created.vault}</code>
              </div>
              <div className="actions">
                <Link className="button light" href="/vault">
                  Go to my Bunker
                </Link>
                <button
                  className="button ghost"
                  disabled={!!b.busy || password.length < 12}
                  onClick={() => b.task("Preparing day key", () => giveDayKey(created, 0n))}
                >
                  Download the day key again
                </button>
              </div>
            </>
          ) : draft ? (
            <>
              <h2>Prove the recovery kit is saved.</h2>
              <p className="modal-copy">
                A file named <code>{fileName(draft.kit)}</code> was downloaded.
                Re-open it here. Nothing is built until this check passes.
              </p>
              <button
                className="button ghost"
                onClick={() => download(fileName(draft.kit), draft.encrypted)}
              >
                Download the recovery kit again
              </button>
              <FileField
                label="Re-open the saved recovery kit"
                disabled={!!b.busy}
                onFile={(f) => f && void b.task("Checking the kit", () => verify(f))}
              />
              {verified && (
                <p className="ice">
                  <Check size={16} style={{ display: "inline", marginRight: 8 }} />
                  Verified: {verified}
                </p>
              )}
              <button
                className="button light"
                disabled={!!b.busy || !verified}
                onClick={() => b.task("Building your Bunker", create)}
              >
                Build Bunker on test network
              </button>
            </>
          ) : (
            <>
              <h2>One kit, kept for good.</h2>
              <p className="modal-copy">
                The recovery kit is created once and never changes. It can
                cancel any withdrawal and replace any day key, so whoever holds
                it and its password controls the Bunker.
              </p>
              <PasswordField label="Recovery password" value={password} onChange={setPassword} />
              <PasswordField label="Confirm recovery password" value={repeat} onChange={setRepeat} />
              <div className={`wait-option ${wait ? "on" : ""}`}>
                <label className="check-label">
                  <Checkbox
                    aria-label="Add a waiting period"
                    checked={wait}
                    onCheckedChange={(v) => {
                      setWait(v === true);
                      setWaitAck(false);
                    }}
                  />
                  <span>
                    <strong>Add a waiting period</strong> (optional). Off by
                    default: withdrawals leave as soon as you approve them.
                  </span>
                </label>
                {wait ? (
                  <>
                    <label className="field">
                      <span>Every withdrawal waits this long before it leaves</span>
                      <select
                        aria-label="Waiting period"
                        value={delay}
                        onChange={(e) => {
                          setDelay(Number(e.target.value));
                          setWaitAck(false);
                        }}
                      >
                        {DELAYS.map(([secs, label]) => (
                          <option key={secs} value={secs}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="check-label">
                      <Checkbox
                        aria-label="Acknowledge the waiting period"
                        checked={waitAck}
                        onCheckedChange={(v) => setWaitAck(v === true)}
                      />
                      <span>
                        I understand that every withdrawal from this Bunker
                        will take {delayLabel(delay)} to arrive, with no way to
                        speed one up, and that this cannot be shortened or
                        turned off for this Bunker later. I am choosing it so
                        I have time to cancel a withdrawal I did not make.
                      </span>
                    </label>
                  </>
                ) : (
                  <p className="micro">
                    What it is for: without one, anyone who gets your day key
                    and its password can withdraw immediately. With one, you
                    get that long to cancel with your recovery kit.
                  </p>
                )}
              </div>
              <label className="check-label">
                <Checkbox
                  aria-label="Acknowledge the recovery kit"
                  checked={ack}
                  onCheckedChange={(v) => setAck(v === true)}
                />
                <span>
                  I will keep the recovery kit off this device, and I
                  understand that losing both it and its password cannot be
                  undone. Test assets only.
                </span>
              </label>
              <button
                className="button light"
                disabled={
                  !b.enabled ||
                  !b.wallet.address ||
                  !!b.busy ||
                  !ack ||
                  (wait && !waitAck) ||
                  password.length < 12
                }
                onClick={() => b.task("Preparing recovery kit", makeKit)}
              >
                Create recovery kit
              </button>
            </>
          )}
        </section>
      ) : (
        <section className="panel tool-panel">
          {!opened ? (
            <>
              <h2>Open your recovery kit.</h2>
              <p className="modal-copy">
                Recovering installs brand-new keys. It kills every earlier day
                key, cancels any withdrawal that is still waiting, and never
                moves your assets.
              </p>
              <FileField label="Recovery kit" onFile={setFile} disabled={!!b.busy} />
              <PasswordField label="Recovery password" value={password} onChange={setPassword} />
              <button
                className="button light"
                disabled={!b.enabled || !b.wallet.address || !!b.busy || !file || password.length < 12}
                onClick={() => b.task("Opening recovery kit", open)}
              >
                Open recovery kit
              </button>
            </>
          ) : (
            <>
              <h2>{recovered !== null ? "New keys installed." : "Ready to recover."}</h2>
              <dl className="withdraw-review">
                <div>
                  <dt>Bunker</dt>
                  <dd>
                    <code>{opened.kit.vault}</code>
                  </dd>
                </div>
                <div>
                  <dt>Key generation</dt>
                  <dd>{opened.chain.epoch.toString()}</dd>
                </div>
                <div>
                  <dt>Pending withdrawal</dt>
                  <dd>
                    {pending
                      ? `${pending.amount.toString()} lamports to ${pending.destination.toBase58()} — will be cancelled`
                      : "None"}
                  </dd>
                </div>
                <div>
                  <dt>Waiting period</dt>
                  <dd>
                    {opened.chain.delaySecs
                      ? formatDuration(BigInt(opened.chain.delaySecs))
                      : "None"}
                  </dd>
                </div>
              </dl>
              {recovered === null && (
                <div className="notice">
                  Safe to retry: the recovery packet for this key generation is
                  always the same bytes. Expect 3 wallet approvals.
                </div>
              )}
              <div className="actions">
                <button
                  className="button light"
                  disabled={!!b.busy || recovered !== null}
                  onClick={() => b.task("Recovering", recover)}
                >
                  {pending ? "Cancel withdrawal and install new keys" : "Install new keys"}
                </button>
                <button
                  className="button ghost"
                  disabled={!!b.busy}
                  onClick={() =>
                    b.task("Preparing day key", () => giveDayKey(opened.kit, opened.chain.epoch))
                  }
                >
                  Download current day key
                </button>
              </div>
              {recovered !== null && (
                <Link className="security-link" href="/vault">
                  Go to my Bunker
                </Link>
              )}
            </>
          )}
        </section>
      )}
    </main>
  );
}
export default function RecoveryTool() {
  return (
    <WalletProvider>
      <Tool />
    </WalletProvider>
  );
}
