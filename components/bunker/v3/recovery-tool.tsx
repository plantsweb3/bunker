"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { PublicKey } from "@solana/web3.js";
import { formatAmount, hex } from "@/sdk/bytes";
import { feePreflight } from "@/sdk/preflight";
import { fetchVault, formatDuration } from "@/sdk/v3/chain";
import { download } from "@/sdk/v3/kit";
import {
  closeProofIx,
  computeIx,
  initializeIx,
  recoverIx,
  stageIxs,
  VaultState,
} from "@/sdk/v3/protocol";
import {
  CreationRequest,
  genesisOf,
  NetworkCard,
  parseCreationRequest,
  parseRecoveryFile,
  recoveryFileStatus,
} from "@/sdk/v3/requests";
import { BIcon } from "../icon";
import { WalletButton, WalletProvider } from "../wallet";
import { FileField, Messages, NetworkPill, readKeyFile, useBunker } from "./shared";
type Packet = ReturnType<typeof parseRecoveryFile>;
type Manifest = { sha256: string; bytes: number };
const TOOL = "/source/bunker-recovery-tool.html";
function Page() {
  const b = useBunker();
  const [mode, setMode] = useState<"create" | "recover">("create");
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [request, setRequest] = useState<CreationRequest | null>(null);
  const [built, setBuilt] = useState("");
  const [packet, setPacket] = useState<{
    file: Packet;
    chain: VaultState;
    status: ReturnType<typeof recoveryFileStatus>;
  } | null>(null);
  const [recovered, setRecovered] = useState(false);
  const [address, setAddress] = useState("");
  const [found, setFound] = useState<VaultState | null>(null);
  useEffect(() => {
    fetch("/source/recovery-tool-manifest.json")
      .then((r) => (r.ok ? (r.json() as Promise<Manifest>) : null))
      .then(setManifest)
      .catch(() => setManifest(null));
  }, []);
  const reset = (next: "create" | "recover") => {
    setMode(next);
    setRequest(null);
    setBuilt("");
    setPacket(null);
    setRecovered(false);
    b.setError("");
    b.setNotice("");
  };
  /** Checking a file needs the network configuration, not a wallet. */
  function belongs(f: { program: string; genesis: string }) {
    const c = b.config;
    if (!c?.custodyEnabled || !c.programId)
      throw new Error(c?.releaseStatus ?? "Configuration unavailable");
    if (f.program !== c.programId || f.genesis !== c.expectedGenesis)
      throw new Error("That file was made for a different network or program");
    return new PublicKey(c.programId);
  }
  async function lookUp() {
    const program = belongs({
      program: b.config?.programId ?? "",
      genesis: b.config?.expectedGenesis ?? "",
    });
    const { state } = await fetchVault(b.connection, program, new PublicKey(address.trim()));
    setFound(state);
  }
  function networkCard() {
    const c = b.config;
    if (!c?.custodyEnabled || !c.programId) throw new Error("Configuration unavailable");
    const card: NetworkCard = {
      version: 3,
      kind: "network",
      network: c.network as "devnet" | "localnet",
      genesis: c.expectedGenesis,
      program: c.programId,
    };
    download(`bunker-test-network-card-${c.network}.json`, JSON.stringify(card, null, 2));
  }
  async function loadRequest(f: File | null) {
    const r = parseCreationRequest(await readKeyFile(f));
    belongs(r);
    setRequest(r);
  }
  async function create() {
    const { program, payer } = b.live();
    if (!request) throw new Error("Choose a creation request");
    const address = new PublicKey(request.vault);
    // The address is a hash of the request, so a Bunker already standing there
    // can only be this one, whoever created it.
    const exists = await b.connection.getAccountInfo(address, "confirmed");
    const fresh = !exists || exists.data.length === 0;
    if (fresh)
      await b.transmit("Building your Bunker", [
        initializeIx(program, payer, genesisOf(request)),
      ]);
    // Read it back: never tell someone to deposit into a Bunker that is not
    // exactly the one their recovery kit describes. The identity is a hash of
    // the whole request and never changes; the keys do, once it is used.
    const { state } = await fetchVault(b.connection, program, address);
    if (
      hex(state.vaultId) !== request.vaultId ||
      state.delaySecs !== request.delaySecs ||
      state.trusted.length !== request.trusted.length ||
      state.trusted.some((t, i) => t.toBase58() !== request.trusted[i])
    )
      throw new Error(
        "The Bunker at this address does not match your creation request. Do not deposit. Make a new recovery kit.",
      );
    if (
      fresh &&
      (hex(state.opRoot) !== request.opRoot || hex(state.recRoot) !== request.recRoot || state.epoch !== 0n)
    )
      throw new Error(
        "The Bunker that was just built does not hold the keys in your creation request. Do not deposit. Make a new recovery kit.",
      );
    setBuilt(request.vault);
    setRequest(null);
    b.setNotice(
      fresh
        ? "Bunker built. Open it with the day key the tool saved."
        : `This Bunker was already built (key generation ${state.epoch}). Nothing was sent. Open it with your current day key.`,
    );
  }
  async function loadPacket(f: File | null) {
    const file = parseRecoveryFile(await readKeyFile(f));
    const program = belongs(file);
    const { state } = await fetchVault(b.connection, program, new PublicKey(file.vault));
    setPacket({ file, chain: state, status: recoveryFileStatus(file, state) });
    setRecovered(false);
  }
  async function recover() {
    const { program, payer } = b.live();
    if (!packet) throw new Error("Choose a recovery packet");
    const { file } = packet;
    // Check against the chain again immediately before spending fees.
    const { state } = await fetchVault(b.connection, program, new PublicKey(file.vault));
    const status = recoveryFileStatus(file, state);
    if (status !== "ready") {
      setPacket({ file, chain: state, status });
      throw new Error("This packet no longer applies to the Bunker");
    }
    // Three approvals follow. Do not start if the wallet cannot finish them.
    await feePreflight(b.connection, payer);
    const stages = stageIxs(program, payer, file.message, file.signatureBytes);
    for (let i = 0; i < stages.length; i++)
      await b.transmit(`Approval ${i + 1} of 3 · publishing the recovery packet`, [stages[i]]);
    await b.transmit("Approval 3 of 3 · installing new keys", [
      computeIx(),
      recoverIx(program, payer, file.payloadBytes, state),
      closeProofIx(program, payer, file.message),
    ]);
    const after = await fetchVault(b.connection, program, new PublicKey(file.vault));
    setPacket({ file, chain: after.state, status: recoveryFileStatus(file, after.state) });
    setRecovered(true);
    b.setNotice(
      "Recovered. Every earlier day key is dead, and a withdrawal that was still waiting has been cancelled. Open your Bunker with the new day key the tool saved.",
    );
  }
  const can = b.enabled && !!b.wallet.address && !b.busy;
  const pending = packet?.chain.pending;
  return (
    <main className="vault-page recovery-page">
      <div className="app-top">
        <div className="app-breadcrumb">
          <BIcon name="recovery-kit" size={18} />
          Recovery
        </div>
        <div className="app-top-actions">
          <NetworkPill config={b.config} />
          <WalletButton />
        </div>
      </div>
      <div className="vault-heading">
        <div>
          <div className="eyebrow">YOUR RECOVERY KIT NEVER COMES HERE</div>
          <h1>Recovery.</h1>
          <p>
            The recovery kit is opened only in a separate tool, away from this
            website. This page takes the public files that tool produces and
            submits them.
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
              The protocol is a draft under review. It runs only against an isolated test network. The
              offline tool below can be inspected today.
            </p>
            <Link href="/verify">View release requirements</Link>
          </div>
          <span className="pill">DRAFT</span>
        </div>
      ) : (
        <div className="notice">
          <BIcon name="simulation" size={18} />
          <span>Draft protocol on a test network. No real assets.</span>
        </div>
      )}
      <Messages busy={b.busy} error={b.error} notice={b.notice} />
      <section className="panel tool-panel offline-tool">
        <div>
          <span className="eyebrow">START HERE</span>
          <h2>Get the offline recovery tool.</h2>
          <p className="modal-copy">
            One file, no installation. It makes and opens your recovery kit,
            so it is built to run away from this website: its own security
            policy stops it making network connections.
          </p>
        </div>
        <ol className="tool-route">
          <li>
            <b>Download both files.</b>
            <span>The tool, and a network card that tells it which network it is building for.</span>
          </li>
          <li>
            <b>Open the tool from where you saved it.</b>
            <span>
              On a device you trust, offline if you can. It needs a computer or an Android phone;
              an iPhone cannot open it, and browsers inside wallet apps usually cannot save its
              files.
            </span>
          </li>
          <li>
            <b>Bring back only the public file it gives you.</b>
            <span>A creation request to build a Bunker, or a recovery packet to replace its keys.</span>
          </li>
        </ol>
        <div className="actions">
          <a className="button light" href={TOOL} download="bunker-recovery-tool.html">
            <BIcon name="recovery-kit" size={17} />
            Download the tool
          </a>
          <button className="button ghost" disabled={!b.enabled} onClick={networkCard}>
            Download network card
          </button>
        </div>
        {b.enabled && b.config && (
          <p className="micro">
            Network <code>{b.config.network}</code> · genesis <code>{b.config.expectedGenesis}</code>{" "}
            · program <code>{b.config.programId}</code>. The tool shows these when you give it the
            network card; they must match.
          </p>
        )}
        {manifest && (
          <p className="micro">
            To check you have the real tool, compare its SHA-256 with a copy from another source:{" "}
            <code>{manifest.sha256}</code> · {manifest.bytes.toLocaleString("en-US")} bytes · built
            from <code>tools/recovery</code> in the public source
          </p>
        )}
      </section>
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
          {built ? (
            <>
              <h2>Your Bunker is built.</h2>
              <div className="vault-address">
                <span>Bunker address</span>
                <code>{built}</code>
              </div>
              <Link className="button light" href="/vault">
                Go to my Bunker
              </Link>
            </>
          ) : (
            <>
              <h2>Submit a creation request.</h2>
              <p className="modal-copy">
                In the offline tool, choose “Build a new Bunker”. It saves a
                recovery kit, a day key and a creation request. Only the
                creation request comes here; it holds your trusted addresses,
                your waiting period and two public commitments, and nothing
                secret.
              </p>
              <FileField
                label="Creation request"
                disabled={!!b.busy}
                onFile={(f) => f && void b.task("Reading", () => loadRequest(f))}
              />
              {request && (
                <dl className="withdraw-review">
                  <div>
                    <dt>Bunker address</dt>
                    <dd>
                      <code>{request.vault}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>Trusted addresses</dt>
                    <dd>
                      {request.trusted.length
                        ? request.trusted.map((t) => (
                            <code key={t} style={{ display: "block" }}>
                              {t}
                            </code>
                          ))
                        : "None"}
                    </dd>
                  </div>
                  <div>
                    <dt>Waiting period</dt>
                    <dd>
                      {request.delaySecs
                        ? request.trusted.length
                          ? `${formatDuration(BigInt(request.delaySecs))} to any other address; none to the trusted ones. Fixed for this Bunker.`
                          : `${formatDuration(BigInt(request.delaySecs))} on every withdrawal, fixed for this Bunker`
                        : "None. Withdrawals leave as soon as they are approved."}
                    </dd>
                  </div>
                </dl>
              )}
              <button
                className="button light"
                disabled={!can || !request}
                onClick={() => b.task("Building your Bunker", create)}
              >
                Build Bunker on test network
              </button>
            </>
          )}
        </section>
      ) : (
        <section className="panel tool-panel">
          <h2>{recovered ? "New keys installed." : "Submit a recovery packet."}</h2>
          <p className="modal-copy">
            In the offline tool, open your recovery kit and enter your
            Bunker’s current key generation. It saves a recovery packet and a
            new day key. Only the packet comes here. Anyone holding a packet
            can do exactly one thing with it: install the keys it names.
          </p>
          <div className="inline-form">
            <label className="field">
              <span>Not sure of your key generation? Look it up by Bunker address</span>
              <input
                autoComplete="off"
                spellCheck={false}
                placeholder="Bunker address"
                value={address}
                onChange={(e) => {
                  setAddress(e.target.value);
                  setFound(null);
                }}
              />
            </label>
            <div className="actions">
              <button
                className="button ghost"
                disabled={!b.enabled || !!b.busy || !address.trim()}
                onClick={() => b.task("Looking up", lookUp)}
              >
                Look up
              </button>
            </div>
            {found && (
              <p className="micro">
                Key generation <b>{found.epoch.toString()}</b>. Enter that number in the offline
                tool. {found.pending ? "A withdrawal is waiting." : "No withdrawal is waiting."}
              </p>
            )}
          </div>
          <FileField
            label="Recovery packet"
            disabled={!!b.busy}
            onFile={(f) => f && void b.task("Checking packet", () => loadPacket(f))}
          />
          {packet && (
            <>
              <dl className="withdraw-review">
                <div>
                  <dt>Bunker</dt>
                  <dd>
                    <code>{packet.file.vault}</code>
                  </dd>
                </div>
                <div>
                  <dt>Key generation on-chain</dt>
                  <dd>{packet.chain.epoch.toString()}</dd>
                </div>
                <div>
                  <dt>This packet</dt>
                  <dd>
                    {packet.status === "ready"
                      ? `Valid for generation ${packet.file.epoch}. Signature checked against the Bunker’s recovery commitment.`
                      : packet.status === "already-applied"
                        ? "Already applied. The Bunker has moved past this generation."
                        : packet.status === "wrong-epoch"
                          ? "Made for a later generation than the Bunker is at. Make one for the generation shown above."
                          : "Signature does not match this Bunker’s recovery commitment. Wrong kit, or a damaged file."}
                  </dd>
                </div>
                <div>
                  <dt>Waiting withdrawal</dt>
                  <dd>
                    {pending
                      ? `${pending.kind === 0 ? `${formatAmount(pending.amount, 9)} SOL` : `${pending.amount.toString()} base units of token ${pending.mint.toBase58()}`} to ${pending.kind === 0 ? "" : "token account "}${pending.destination.toBase58()}. Recovery cancels it if it lands before the withdrawal is released.`
                      : "None"}
                  </dd>
                </div>
              </dl>
              {packet.status === "ready" && (
                <div className="notice">
                  Safe to retry: this packet is always the same bytes. Expect
                  3 wallet approvals.
                </div>
              )}
              <div className="actions">
                <button
                  className="button light"
                  disabled={!can || packet.status !== "ready"}
                  onClick={() => b.task("Recovering", recover)}
                >
                  {pending ? "Cancel withdrawal and install new keys" : "Install new keys"}
                </button>
                {recovered && (
                  <Link className="button ghost" href="/vault">
                    Go to my Bunker
                  </Link>
                )}
              </div>
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
      <Page />
    </WalletProvider>
  );
}
