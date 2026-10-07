"use client";
import "@/sdk/polyfill";
import { useEffect, useState, useCallback, useRef, useId } from "react";
import Link from "next/link";
import { PublicKey } from "@solana/web3.js";
import {
  Shield,
  Wallet,
  Plus,
  Upload,
  Download,
  RefreshCw,
  LockKeyhole,
  ExternalLink,
  Check,
  LoaderCircle,
  Fingerprint,
  Copy,
  FileCheck2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { WalletProvider, WalletButton, useWallet } from "./wallet";
import type { BunkerConfig } from "@/lib/bunker-config";
import {
  createConnection,
  assets,
  Asset,
  fetchVault,
  send,
  depositIxs,
  withdrawalDestination,
  explorer,
  assertNetwork,
} from "@/sdk/client";
import { hex, unhex, parseAmount, formatAmount } from "@/sdk/bytes";
import { mintLabel } from "@/sdk/known-mints";
import { generateKey } from "@/sdk/winternitz";
import {
  RecoveryKit,
  encryptKit,
  decryptKit,
  downloadKit,
  adoptRecovery,
  authorizeWithdrawal,
  recoveryCheckpoint,
  validateRecoveryKit,
} from "@/sdk/recovery";
import {
  vaultAddress,
  initializeIx,
  encodeIntent,
  decodeIntent,
  stageIxs,
  withdrawIx,
  computeIx,
  closeProofIx,
} from "@/sdk/protocol";
type Modal = "create" | "restore" | "deposit" | "withdraw" | null;
type Activity = { signature: string; label: string };
// Approximate only: Solana targets 400 ms per slot but slots are not wall-clock time.
const SLOT_MS = 400;
const WINDOWS = [
  ["9000", "About 1 hour"],
  ["54000", "About 6 hours"],
  ["216000", "About 24 hours"],
] as const;
const aboutTime = (slots: bigint) => {
  const minutes = Number(slots) * (SLOT_MS / 60000);
  if (minutes < 1) return "less than a minute";
  if (minutes < 90) return `about ${Math.round(minutes)} min`;
  return `about ${Math.round(minutes / 60)} h`;
};
const friendly: [RegExp, string][] = [
  [
    /503|RPC unavailable|fetch failed|Failed to fetch/,
    "The Solana connection is unavailable. Nothing was sent. Try again in a moment.",
  ],
  [
    /Invalid withdrawal intent|Invalid withdrawal encoding/,
    "This withdrawal could not be prepared. Check the amount and recipient, then try again. Nothing was signed.",
  ],
  [
    /Journal missing/,
    "This browser has no record of this Bunker. Use Restore and open your newest recovery file to continue.",
  ],
  [
    /Invalid public key input|Non-base58 character/,
    "That is not a valid Solana address. Paste the full recipient address.",
  ],
  [
    /User rejected|rejected the request/i,
    "The request was declined in your wallet. Nothing was sent.",
  ],
  [
    /OperationError|decrypt/i,
    "That password does not open this recovery file. Check the password and the file.",
  ],
];
const errText = (e: unknown) => {
  const m =
    e instanceof Error ? e.message : "The operation could not be completed.";
  return friendly.find(([pattern]) => pattern.test(m))?.[1] ?? m;
};
function App() {
  const wallet = useWallet();
  const [config, setConfig] = useState<BunkerConfig | null>(null);
  const [connection] = useState(createConnection);
  const [modal, setModal] = useState<Modal>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [walletAssets, setWalletAssets] = useState<Asset[]>([]);
  const [vaultAssets, setVaultAssets] = useState<Asset[]>([]);
  const [kit, setKit] = useState<RecoveryKit | null>(null);
  const [onchain, setOnchain] = useState(false);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [ack, setAck] = useState(false);
  const [verifiedBackup, setVerifiedBackup] = useState(false);
  const [encrypted, setEncrypted] = useState("");
  const [assetKey, setAssetKey] = useState("SOL");
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [expirySlots, setExpirySlots] = useState<string>("216000");
  const [checkpointVault, setCheckpointVault] = useState("");
  const [slotNow, setSlotNow] = useState<bigint | null>(null);
  const [phase, setPhase] = useState<"entry" | "review" | "backup">("entry");
  const [recoveryFileName, setRecoveryFileName] = useState("");
  const inFlight = useRef(false);
  useEffect(() => {
    fetch("/api/config")
      .then((r) => {
        if (!r.ok) throw new Error("Cannot load network configuration");
        return r.json() as Promise<BunkerConfig>;
      })
      .then(setConfig)
      .catch((e) => setError(errText(e)));
  }, []);
  const refresh = useCallback(async () => {
    if (!config) return;
    await assertNetwork(connection, config);
    if (wallet.address)
      setWalletAssets(await assets(connection, wallet.address));
    else setWalletAssets([]);
    if (kit && config.programId) {
      const state = await fetchVault(
        connection,
        new PublicKey(config.programId),
        new PublicKey(kit.vault),
      );
      setOnchain(true);
      setVaultAssets(await assets(connection, new PublicKey(kit.vault), true));
      const checkpoint = recoveryCheckpoint(kit);
      if (!checkpoint)
        throw new Error(
          "Journal missing; explicitly import your recovery file",
        );
      const current = await adoptRecovery(
        kit,
        checkpoint,
        {
          ...state,
          slot: BigInt(await connection.getSlot()),
        },
        "reconcile",
      );
      if (current.currentIndex !== kit.currentIndex) {
        setKit(current);
        setNotice(
          "Withdrawal confirmed and authority rotated. Your saved pending recovery file also restores this new key.",
        );
      }
    }
  }, [config, connection, wallet.address, kit]);
  useEffect(() => {
    if (!config) return;
    let current = true;
    const run = async () => {
      try {
        if (wallet.address) {
          await assertNetwork(connection, config);
          const a = await assets(connection, wallet.address);
          if (current) setWalletAssets(a);
        } else setWalletAssets([]);
      } catch (e) {
        if (current) setError(errText(e));
      }
    };
    void run();
    return () => {
      current = false;
    };
  }, [config, connection, wallet.address]);
  async function task(label: string, fn: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy("");
      inFlight.current = false;
    }
  }
  function open(m: Modal) {
    setModal(m);
    setError("");
    setPassword("");
    setRepeat("");
    setFile(null);
    setAck(false);
    setVerifiedBackup(false);
    setEncrypted("");
    setPhase("entry");
    setAmount("");
    setAssetKey("SOL");
    setRecipient("");
    setCheckpointVault("");
    setExpirySlots("216000");
    setRecoveryFileName("");
  }
  function requireLive() {
    if (!config?.custodyEnabled || !config.programId)
      throw new Error(config?.releaseStatus ?? "Configuration unavailable");
    if (!wallet.address) throw new Error("Connect your wallet first");
    return {
      c: config,
      program: new PublicKey(config.programId),
      payer: wallet.address,
    };
  }
  function record(label: string) {
    return (signature: string) =>
      setActivity((old) => [{ label, signature }, ...old].slice(0, 20));
  }
  async function transmit(label: string, ixs: Parameters<typeof send>[3]) {
    const { c, payer } = requireLive();
    setBusy(label);
    return send(connection, c, payer, ixs, wallet.sign, record(label));
  }
  async function makeKit() {
    const { c, program } = requireLive();
    if (password !== repeat) throw new Error("Passwords do not match");
    if (!ack) throw new Error("Acknowledge the recovery requirements");
    await assertNetwork(connection, c, true);
    const { id, keys } = {
      id: crypto.getRandomValues(new Uint8Array(32)),
      keys: generateKey(),
    };
    const next: RecoveryKit = {
      version: 2,
      currentIndex: "0",
      nextUnusedIndex: "1",
      network: c.network as "devnet" | "localnet",
      genesis: c.expectedGenesis,
      program: program.toBase58(),
      vaultId: hex(id),
      vault: vaultAddress(program, id).toBase58(),
      nonce: "0",
      root: hex(keys.root),
      secret: hex(keys.secret),
    };
    keys.secret.fill(0);
    const encrypted = await encryptKit(next, password);
    await adoptRecovery(
      next,
      encrypted,
      { nonce: 0n, root: unhex(next.root), slot: 0n },
      "create",
    );
    setKit(next);
    setOnchain(false);
    setEncrypted(encrypted);
    setPhase("backup");
    downloadKit(encrypted, next.vault, next.nonce);
  }
  async function verifyFile(f: File) {
    if (f.size > 35000) throw new Error("Recovery file is too large");
    const restored = await validateKit(
      await decryptKit(await f.text(), password),
    );
    if (
      !kit ||
      JSON.stringify(restored) !== JSON.stringify(validateRecoveryKit(kit))
    )
      throw new Error(
        "Choose the recovery file just downloaded for this operation",
      );
    setVerifiedBackup(true);
    setRecoveryFileName(f.name);
  }
  async function validateKit(restored: RecoveryKit) {
    if (
      !config?.programId ||
      restored.program !== config.programId ||
      restored.network !== config.network ||
      restored.genesis !== config.expectedGenesis
    )
      throw new Error(
        "Recovery file belongs to a different network or program",
      );
    return validateRecoveryKit(restored);
  }
  async function restore() {
    requireLive();
    if (!file) throw new Error("Choose your encrypted recovery file");
    if (file.size > 35000) throw new Error("Recovery file is too large");
    const raw = await file.text();
    const restored = await validateKit(await decryptKit(raw, password));
    await assertNetwork(connection, config!, true);
    const state = await fetchVault(
      connection,
      new PublicKey(restored.program),
      new PublicKey(restored.vault),
    );
    const current = await adoptRecovery(
      restored,
      raw,
      {
        ...state,
        slot: BigInt(await connection.getSlot()),
      },
      "import",
    );
    setKit(current);
    setOnchain(true);
    setVaultAssets(
      await assets(connection, new PublicKey(current.vault), true),
    );
    setModal(null);
    setPassword("");
    setNotice(
      current.pending
        ? "Interrupted withdrawal restored. Resume its exact authorization; do not create another."
        : "Bunker restored. Recovery secrets remain in this tab’s memory.",
    );
  }
  async function create() {
    const { program, payer } = requireLive();
    if (!kit || !verifiedBackup)
      throw new Error("Re-open and verify your downloaded recovery file first");
    const existing = await connection.getAccountInfo(new PublicKey(kit.vault));
    if (existing?.owner.equals(program)) {
      const state = await fetchVault(
        connection,
        program,
        new PublicKey(kit.vault),
      );
      if (hex(state.root) !== kit.root)
        throw new Error("An existing vault has a different authority");
    } else
      await transmit("Create Bunker", [
        initializeIx(program, payer, unhex(kit.vaultId), unhex(kit.root)),
      ]);
    setOnchain(true);
    setModal(null);
    setPassword("");
    setVaultAssets(await assets(connection, new PublicKey(kit.vault), true));
    setNotice(
      "Bunker created. The connected wallet does not have withdrawal authority.",
    );
  }
  const selectedAssets = modal === "deposit" ? walletAssets : vaultAssets;
  const selectedAsset =
    selectedAssets.find((a) => a.key === assetKey) ?? selectedAssets[0];
  async function deposit() {
    const { program, payer } = requireLive();
    if (!kit || !selectedAsset)
      throw new Error("Create or restore a Bunker first");
    await fetchVault(connection, program, new PublicKey(kit.vault));
    await transmit(
      "Deposit assets",
      await depositIxs(
        payer,
        new PublicKey(kit.vault),
        selectedAsset,
        parseAmount(amount, selectedAsset.decimals),
      ),
    );
    setModal(null);
    await refresh();
    setNotice("Deposit confirmed on the test network.");
  }
  function reviewWithdrawal() {
    if (!kit?.secret || kit.pending || !selectedAsset)
      throw new Error(
        "Restore the current recovery file or resume your pending withdrawal",
      );
    const qty = parseAmount(amount, selectedAsset.decimals);
    if (qty > selectedAsset.amount || selectedAsset.frozen)
      throw new Error("Insufficient transferable balance");
    if (new PublicKey(recipient).toBase58() === kit.vault)
      throw new Error("Choose a destination outside this Bunker");
    setPhase("review");
  }
  async function prepareWithdrawal() {
    const { program, payer, c } = requireLive();
    if (!kit?.secret || kit.pending || !selectedAsset)
      throw new Error(
        "Restore the current recovery file or resume your pending withdrawal",
      );
    if (!ack) throw new Error("Acknowledge the one-time-key requirements");
    const qty = parseAmount(amount, selectedAsset.decimals);
    if (qty > selectedAsset.amount || selectedAsset.frozen)
      throw new Error("Insufficient transferable balance");
    const recipientKey = new PublicKey(recipient);
    if (recipientKey.toBase58() === kit.vault)
      throw new Error("Choose a destination outside this Bunker");
    const state = await fetchVault(
      connection,
      program,
      new PublicKey(kit.vault),
    );
    if (state.nonce !== BigInt(kit.nonce) || hex(state.root) !== kit.root)
      throw new Error(
        "Recovery state is stale. Restore the newest recovery file.",
      );
    const dest = await withdrawalDestination(
      connection,
      payer,
      recipientKey,
      selectedAsset,
    );
    if (!/^[1-9][0-9]{0,5}$/.test(expirySlots))
      throw new Error("Choose an authorization lifetime of 1–999999 slots");
    const next = generateKey();
    const signingSlot = BigInt(await connection.getSlot());
    setSlotNow(signingSlot);
    const payload = encodeIntent({
      vaultId: unhex(kit.vaultId),
      expirySlot: signingSlot + BigInt(expirySlots),
      nonce: state.nonce,
      kind: selectedAsset.mint ? 1 : 0,
      mint: selectedAsset.mint
        ? new PublicKey(selectedAsset.mint)
        : PublicKey.default,
      destination: dest.destination,
      amount: qty,
      nextRoot: next.root,
    });
    try {
      const result = await authorizeWithdrawal(
        kit,
        payload,
        next.secret,
        {
          sourceToken: selectedAsset.account ?? undefined,
          recipient,
        },
        password,
        async () => {
          await assertNetwork(connection, c, true);
          return {
            ...(await fetchVault(
              connection,
              program,
              new PublicKey(kit.vault),
            )),
            slot: BigInt(await connection.getSlot()),
          };
        },
      );
      setKit(result.kit);
      setEncrypted(result.encrypted);
      setPhase("backup");
      setVerifiedBackup(false);
      downloadKit(result.encrypted, kit.vault, kit.nonce, true);
    } finally {
      next.secret.fill(0);
    }
  }
  async function resumeWithdrawal() {
    const { program, payer } = requireLive();
    if (!kit?.pending) throw new Error("No pending withdrawal");
    if (!verifiedBackup)
      throw new Error(
        "Verify the pending recovery file before publishing authorization",
      );
    await validateKit(kit);
    const payload = unhex(kit.pending.payload),
      intent = decodeIntent(payload),
      v = new PublicKey(kit.vault);
    const state = await fetchVault(connection, program, v);
    const checkpoint = recoveryCheckpoint(kit);
    if (!checkpoint)
      throw new Error("Journal missing; explicitly import the recovery blob");
    const slot = BigInt(await connection.getSlot());
    setSlotNow(slot);
    const current = await adoptRecovery(
      kit,
      checkpoint,
      { ...state, slot },
      "reconcile",
    );
    if (!current.pending) {
      setKit(current);
      setModal(null);
      return;
    }
    if (slot > intent.expirySlot)
      throw new Error(
        "Authorization expired. This key remains consumed. There is no safe replacement or cancellation; assets may remain locked.",
      );
    const source =
      intent.kind === 1 ? new PublicKey(kit.pending.sourceToken!) : undefined;
    const asset: Asset = {
      key: "pending",
      mint: intent.kind === 1 ? intent.mint.toBase58() : null,
      account: source?.toBase58() ?? null,
      label: "pending",
      amount: intent.amount,
      decimals: 9,
      frozen: false,
    };
    const destination = await withdrawalDestination(
      connection,
      payer,
      new PublicKey(kit.pending.recipient),
      asset,
    );
    if (!destination.destination.equals(intent.destination))
      throw new Error(
        "Recovery destination does not match signed authorization",
      );
    const stages = stageIxs(
      program,
      payer,
      v,
      payload,
      unhex(kit.pending.signature),
    );
    try {
      for (let i = 0; i < stages.length; i++)
        await transmit(
          `Approval ${i + 1} of 3 · publishing authorization`,
          [stages[i]],
        );
      await transmit("Approval 3 of 3 · withdrawing and changing the lock", [
        computeIx(),
        ...destination.setup,
        withdrawIx(program, payer, v, payload, unhex(kit.root), source),
        closeProofIx(program, payer, v, payload),
      ]);
      setModal(null);
      setPassword("");
      await refresh();
    } catch (e) {
      // Reconcile a possibly confirmed submission; never restore the spent key.
      try {
        await refresh();
      } catch {
        /* Preserve the submission error and consumed journal. */
      }
      throw e;
    }
  }
  async function openPending() {
    open("withdraw");
    setPhase("backup");
    setEncrypted("");
    setVerifiedBackup(false);
    setSlotNow(null);
    connection
      .getSlot()
      .then((slot) => setSlotNow(BigInt(slot)))
      .catch(() => {});
  }
  const pendingIntent = kit?.pending
    ? decodeIntent(unhex(kit.pending.payload))
    : null;
  const canCreate = !!config?.custodyEnabled && !!wallet.address && !busy;
  return (
    <main className="vault-page">
      <div className="app-top">
        <div className="app-breadcrumb">
          <Shield size={17} />
          Vault
        </div>
        <div className="app-top-actions">
          <span className="pill">
            {config?.network === "mainnet-beta"
              ? "MAINNET · READ ONLY"
              : config?.network === "localnet"
                ? "LOCAL TEST NETWORK"
                : config
                  ? "DEVNET · TEST ASSETS"
                  : "CONNECTING"}
          </span>
          <WalletButton />
        </div>
      </div>
      <div className="vault-heading">
        <div>
          <div className="eyebrow">INDEPENDENT BY DESIGN</div>
          <h1>Your Bunker.</h1>
          <p>Separate the wallet you use from the assets you hold.</p>
        </div>
        <button
          className="text-button"
          disabled={!!busy || !config}
          onClick={() => task("Refreshing", refresh)}
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>
      {!config ? (
        <div className="notice">Loading release and network configuration…</div>
      ) : !config.custodyEnabled ? (
        <div className="release-gate">
          <LockKeyhole size={22} />
          <div>
            <h2>Hash-based custody. Review before release.</h2>
            <p>
              The mainnet app can connect and read your wallet. Creating a vault
              and moving real assets stay locked until the cryptography and
              program receive independent review.
            </p>
            <Link href="/verify">View release requirements</Link>
          </div>
          <span className="pill">REVIEW PENDING</span>
        </div>
      ) : (
        <div className="notice">
          <Shield size={18} />
          <span>
            Experimental test custody. This is{" "}
            {config?.network === "localnet"
              ? "an isolated local validator"
              : "Solana devnet"}
            . No real assets. No completed audit.
          </span>
        </div>
      )}
      {error && (
        <div role="alert" className="error-box app-message">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="success-box app-message">
          {notice}
        </div>
      )}
      {busy && (
        <div className="loading app-message" role="status">
          <LoaderCircle size={16} className="spin" />
          {busy}…
        </div>
      )}
      <div className="vault-grid">
        <section className="panel balance-panel">
          <div className="panel-head">
            <span className="eyebrow">BUNKER OVERVIEW</span>
            <Shield size={21} />
          </div>
          {kit && onchain ? (
            <>
              <span className="balance-label">
                Available SOL · rent reserve excluded
              </span>
              <div className="vault-balance">
                {formatAmount(
                  vaultAssets.find((a) => a.key === "SOL")?.amount ?? 0n,
                  9,
                )}
                <span>SOL</span>
              </div>
              <div className="vault-address">
                <span>Vault address</span>
                <code>{kit.vault}</code>
                <button
                  aria-label="Copy vault address"
                  onClick={() =>
                    task("Copying address", async () => {
                      await navigator.clipboard.writeText(kit.vault);
                      setNotice("Vault address copied");
                    })
                  }
                >
                  <Copy size={14} />
                </button>
              </div>
              <div className="actions">
                <button
                  className="button light"
                  disabled={!canCreate || !!kit.pending}
                  onClick={() => open("deposit")}
                >
                  <Plus size={15} />
                  Deposit
                </button>
                <button
                  className="button ghost"
                  disabled={!canCreate}
                  onClick={() =>
                    kit.pending ? openPending() : open("withdraw")
                  }
                >
                  {kit.pending ? "Resume withdrawal" : "Withdraw"}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="empty-vault-icon">
                <Shield size={38} strokeWidth={1} />
              </div>
              <h2>A separate home for your assets.</h2>
              <p>
                Create a Bunker or restore one with its encrypted recovery file.
              </p>
              <div className="actions">
                <button
                  className="button light"
                  disabled={!canCreate}
                  onClick={() => open("create")}
                >
                  <Plus size={15} />
                  Create Bunker
                </button>
                <button
                  className="button ghost"
                  disabled={!canCreate}
                  onClick={() => open("restore")}
                >
                  <Upload size={14} />
                  Restore
                </button>
              </div>
              <span className="micro">
                {config?.custodyEnabled
                  ? "TEST ASSETS ONLY · INDEPENDENT RECOVERY KEY"
                  : "REAL-FUND CUSTODY OPENS AFTER EXTERNAL REVIEW"}
              </span>
            </>
          )}
        </section>
        <aside className="panel authority-panel">
          <div className="panel-head">
            <h2>Security at a glance</h2>
            <Fingerprint size={20} />
          </div>
          <div className="metric">
            <span>Withdrawal authority</span>
            <b>Separate hash key</b>
          </div>
          <div className="metric">
            <span>Wallet spending authority</span>
            <b>None over the vault</b>
          </div>
          <div className="metric">
            <span>Key rotations</span>
            <b>{kit?.nonce ?? "—"}</b>
          </div>
          <div className="metric">
            <span>Independent review</span>
            <b className="amber">Pending</b>
          </div>
          <div className="metric">
            <span>Mainnet custody</span>
            <b>Locked</b>
          </div>
          <Link className="security-link" href="/security">
            <Shield size={15} />
            Read the security model
            <ExternalLink size={12} />
          </Link>
        </aside>
      </div>
      <Tabs defaultValue="wallet" className="asset-tabs">
        <TabsList variant="line">
          <TabsTrigger value="wallet">Connected wallet</TabsTrigger>
          <TabsTrigger value="vault">Bunker assets</TabsTrigger>
          <TabsTrigger value="activity">Session activity</TabsTrigger>
        </TabsList>
        <TabsContent value="wallet">
          <AssetTable
            assets={walletAssets}
            empty={
              wallet.address
                ? "No balances loaded. Refresh to query the network."
                : "Connect a wallet to see your SOL and classic SPL balances."
            }
          />
        </TabsContent>
        <TabsContent value="vault">
          <AssetTable
            assets={vaultAssets}
            empty="Your Bunker balances will appear here after you create or restore a vault."
          />
        </TabsContent>
        <TabsContent value="activity">
          <div className="panel activity-panel">
            {activity.length ? (
              activity.map((a, i) => (
                <div key={a.signature + i}>
                  <div>
                    <span>{a.label}</span>
                    <code>{a.signature}</code>
                  </div>
                  {config && explorer(a.signature, config.network) ? (
                    <a
                      href={explorer(a.signature, config.network)!}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Explorer
                      <ExternalLink size={13} />
                    </a>
                  ) : (
                    <span>Local validator</span>
                  )}
                </div>
              ))
            ) : (
              <div className="empty-state">
                <FileCheck2 />
                <h3>No transactions in this session</h3>
                <p>
                  Submitted transaction signatures appear here. Submission alone
                  does not mean confirmation.
                </p>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
      <div className="workspace-bottom">
        <div>
          <LockKeyhole size={17} />
          <span>
            Recovery keys stay in your browser session. Encrypted pending
            backups may be stored locally for crash recovery.
          </span>
        </div>
        <Link href="/demo">Explore the no-wallet demo</Link>
      </div>
      <Dialog
        open={modal !== null}
        onOpenChange={(v) => {
          if (!v && !busy) {
            setModal(null);
            setPassword("");
            setRepeat("");
          }
        }}
      >
        <DialogContent className="dialog-wide">
          <DialogTitle>
            {modal === "create"
              ? "Create your Bunker"
              : modal === "restore"
                ? "Restore your Bunker"
                : modal === "deposit"
                  ? "Deposit into Bunker"
                  : "Authorize a withdrawal"}
          </DialogTitle>
          <DialogDescription>
            {modal === "deposit"
              ? "Your wallet approves this deposit. The vault’s recovery key controls withdrawals."
              : modal === "restore"
                ? "Open your latest encrypted recovery file. Your wallet pays fees; the file supplies independent authorization."
                : phase === "review"
                  ? "Check every detail. Signing uses up this Bunker key: the withdrawal below is the only one it can ever authorize."
                  : phase === "backup"
                    ? "Save and re-open the encrypted recovery file before continuing. Keep the password separately."
                    : "Test custody only. The browser handles sensitive keys. An independent security review is still required."}
          </DialogDescription>
          {modal === "restore" ? (
            <>
              <label className="field">
                <span>Encrypted recovery file</span>
                <input
                  aria-label="Encrypted recovery file"
                  type="file"
                  accept=".json,application/json"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
              <Password value={password} onChange={setPassword} />
              <button
                className="button light"
                disabled={!!busy || !file}
                onClick={() => task("Restoring Bunker", restore)}
              >
                Unlock recovery file
              </button>
              <details className="advanced">
                <summary>
                  A withdrawal was interrupted and I don’t have its file
                </summary>
                <p className="modal-copy">
                  This browser keeps an encrypted checkpoint of an interrupted
                  withdrawal. Enter the vault address to load it, then unlock
                  it with your recovery password above.
                </p>
              <label className="field">
                <span>Vault address for local checkpoint</span>
                <input
                  value={checkpointVault}
                  onChange={(e) => setCheckpointVault(e.target.value)}
                  placeholder="Bunker vault address"
                />
              </label>
              <button
                className="text-button"
                disabled={!!busy || !checkpointVault}
                onClick={() =>
                  task("Reading checkpoint", async () => {
                    const v = new PublicKey(checkpointVault);
                    const raw = recoveryCheckpoint({
                      vault: v.toBase58(),
                      program: config!.programId!,
                      genesis: config!.expectedGenesis,
                    });
                    if (!raw)
                      throw new Error(
                        "No encrypted checkpoint on this browser",
                      );
                    const blob = new File([raw], "local-checkpoint.json", {
                      type: "application/json",
                    });
                    setFile(blob);
                    setNotice(
                      "Local encrypted checkpoint selected. Enter its password and unlock.",
                    );
                  })
                }
              >
                Use local encrypted checkpoint
              </button>
              </details>
            </>
          ) : phase === "backup" ? (
            <>
              <div className="recovery-summary">
                <FileCheck2 size={24} />
                <div>
                  <strong>
                    {kit?.pending
                      ? "Pending withdrawal recovery"
                      : "Bunker recovery kit"}
                  </strong>
                  <span>Encrypted with AES-256-GCM · password required</span>
                </div>
              </div>
              {kit?.pending && (
                <div className="notice">
                  Only resume this exact withdrawal. Do not reuse an older
                  recovery file to authorize a different transfer.{" "}
                  {pendingIntent && slotNow !== null
                    ? pendingIntent.expirySlot >= slotNow
                      ? `Finish within ${aboutTime(pendingIntent.expirySlot - slotNow)}. `
                      : "This authorization has expired. "
                    : ""}
                  Expiry slot: {pendingIntent?.expirySlot.toString()}. After
                  expiry, the key stays consumed and assets may remain locked.
                </div>
              )}
              {encrypted && (
                <button
                  className="button ghost"
                  onClick={() =>
                    kit &&
                    downloadKit(encrypted, kit.vault, kit.nonce, !!kit.pending)
                  }
                >
                  <Download size={15} />
                  Download recovery file again
                </button>
              )}
              {!encrypted && (
                <Password value={password} onChange={setPassword} />
              )}
              <label className="field">
                <span>Re-open the saved recovery file to verify it</span>
                <input
                  aria-label="Verify saved recovery file"
                  type="file"
                  accept=".json,application/json"
                  disabled={!!busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void task("Verifying backup", () => verifyFile(f));
                  }}
                />
              </label>
              {verifiedBackup && (
                <p className="ice">
                  <Check
                    size={16}
                    style={{ display: "inline", marginRight: 8 }}
                  />
                  Verified: {recoveryFileName}
                </p>
              )}
              <button
                className="button light"
                disabled={!!busy || !verifiedBackup}
                onClick={() =>
                  task(
                    modal === "create"
                      ? "Creating Bunker"
                      : "Resuming withdrawal",
                    modal === "create" ? create : resumeWithdrawal,
                  )
                }
              >
                {modal === "create"
                  ? "Create Bunker on test network"
                  : "Publish & complete withdrawal"}
              </button>
              <p className="modal-copy">
                {kit?.pending
                  ? "Expect 3 wallet approvals: 2 signature uploads, then the atomic withdrawal and key rotation. Failed or timed-out submissions can resume this exact signature only before expiry. An expired authorization has no cancellation or replacement path."
                  : "One wallet approval creates the vault. No assets are deposited automatically."}
              </p>
            </>
          ) : phase === "review" && selectedAsset ? (
            <>
              <dl className="withdraw-review">
                <div>
                  <dt>You are withdrawing</dt>
                  <dd className="review-amount">
                    {amount} {selectedAsset.mint ? "tokens" : "SOL"}
                  </dd>
                </div>
                {selectedAsset.mint && (
                  <div>
                    <dt>Token mint</dt>
                    <dd>
                      <code>{selectedAsset.mint}</code>
                    </dd>
                  </div>
                )}
                <div>
                  <dt>To this address</dt>
                  <dd>
                    <code>{recipient}</code>
                  </dd>
                </div>
                <div>
                  <dt>Time to finish</dt>
                  <dd>
                    {WINDOWS.find(([v]) => v === expirySlots)?.[1]} ·{" "}
                    {Number(expirySlots).toLocaleString("en-US")} slots
                  </dd>
                </div>
                <div>
                  <dt>What happens next</dt>
                  <dd>
                    A new recovery file downloads. You re-open it to prove it
                    is saved, then approve 3 transactions in your wallet.
                  </dd>
                </div>
              </dl>
              <Password value={password} onChange={setPassword} />
              <label className="check-label">
                <Checkbox
                  checked={ack}
                  onCheckedChange={(v) => setAck(v === true)}
                />
                <span>
                  I checked the full recipient and amount. This one-time
                  authorization cannot be replaced with a different withdrawal
                  after signing begins, even if submission fails or expires.
                </span>
              </label>
              <div className="notice">
                Use one browser and the latest recovery file. A stale backup or
                a second device can cause unsafe key reuse.
              </div>
              <div className="actions">
                <button
                  className="button ghost"
                  disabled={!!busy}
                  onClick={() => {
                    setPhase("entry");
                    setAck(false);
                    setError("");
                  }}
                >
                  Back
                </button>
                <button
                  className="button light"
                  disabled={!!busy || !ack || !password}
                  onClick={() => task("Preparing withdrawal", prepareWithdrawal)}
                >
                  Sign and save recovery file
                </button>
              </div>
            </>
          ) : modal === "create" ? (
            <>
              <Password value={password} onChange={setPassword} />
              <label className="field">
                <span>Confirm recovery password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={repeat}
                  onChange={(e) => setRepeat(e.target.value)}
                />
              </label>
              <label className="check-label">
                <Checkbox
                  checked={ack}
                  onCheckedChange={(v) => setAck(v === true)}
                />
                <span>
                  I understand that losing my recovery file or password can
                  permanently lock funds. I will use test assets only.
                </span>
              </label>
              <button
                className="button light"
                disabled={!!busy || !ack || password.length < 12}
                onClick={() => task("Preparing recovery kit", makeKit)}
              >
                <Download size={15} />
                Generate & save recovery kit
              </button>
            </>
          ) : (
            <>
              <label className="field">
                <span>Asset</span>
                <select
                  value={assetKey}
                  onChange={(e) => setAssetKey(e.target.value)}
                >
                  {selectedAssets.map((a) => (
                    <option key={a.key} value={a.key} disabled={a.frozen}>
                      {a.label}
                      {a.frozen ? " (frozen)" : ""}
                    </option>
                  ))}
                </select>
                <small>
                  Available:{" "}
                  {selectedAsset
                    ? formatAmount(selectedAsset.amount, selectedAsset.decimals)
                    : "0"}
                  {selectedAsset?.mint && (
                    <>
                      <br />
                      Mint: {selectedAsset.mint}
                    </>
                  )}
                </small>
              </label>
              <label className="field">
                <span>Amount</span>
                <input
                  inputMode="decimal"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
              {modal === "withdraw" && (
                <>
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
                  <label className="field">
                    <span>Time to finish this withdrawal</span>
                    <select
                      aria-label="Time to finish this withdrawal"
                      value={expirySlots}
                      onChange={(e) => setExpirySlots(e.target.value)}
                    >
                      {WINDOWS.map(([slots, label]) => (
                        <option key={slots} value={slots}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <small>
                      If the withdrawal is not completed in this window, the
                      key is used up and assets can be permanently locked.
                      Times are estimates; the limit is counted in network
                      slots.
                    </small>
                  </label>
                </>
              )}
              <div className="notice">
                {modal === "deposit"
                  ? "Network fees and token-account rent are additional. SOL reserved for vault rent is not withdrawable."
                  : "Nothing is signed yet. You will review every detail on the next screen."}
              </div>
              <button
                className="button light"
                disabled={
                  !!busy ||
                  !amount ||
                  !selectedAsset ||
                  (modal === "withdraw" && !recipient)
                }
                onClick={() =>
                  task(
                    modal === "deposit" ? "Depositing" : "Checking withdrawal",
                    modal === "deposit" ? deposit : async () => reviewWithdrawal(),
                  )
                }
              >
                {modal === "deposit"
                  ? "Review deposit in wallet"
                  : "Review withdrawal"}
              </button>
            </>
          )}
          {busy && (
            <p className="loading" role="status">
              <LoaderCircle className="spin" size={16} />
              {busy}…
            </p>
          )}
          {error && (
            <div className="error-box" role="alert">
              {error}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
function Password({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const hintId = useId();
  return (
    <label className="field">
      <span>Recovery password</span>
      <input
        type="password"
        aria-label="Recovery password"
        aria-describedby={hintId}
        autoComplete="new-password"
        minLength={12}
        placeholder="At least 12 characters"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <small id={hintId}>
        Use a unique long password. Bunker cannot reset it.
      </small>
    </label>
  );
}
function AssetTable({ assets, empty }: { assets: Asset[]; empty: string }) {
  return (
    <div className="panel assets-panel">
      {assets.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Asset</TableHead>
              <TableHead>Mint / standard</TableHead>
              <TableHead className="text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {assets.map((a) => (
              <TableRow key={a.key}>
                <TableCell>
                  <div className="asset-name">
                    <span className="asset-logo">{a.mint ? "◈" : "≋"}</span>
                    <div>
                      {a.mint ? (mintLabel(a.mint) ?? "SPL token") : "Solana"}
                      <small>
                        {a.frozen ? "Frozen" : a.mint ? "Classic token" : "SOL"}
                      </small>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <span className="address">
                    {a.mint
                      ? `${a.mint.slice(0, 6)}…${a.mint.slice(-6)}`
                      : "Native SOL"}
                  </span>
                </TableCell>
                <TableCell className="text-right asset-amount">
                  {formatAmount(a.amount, a.decimals)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <div className="empty-state">
          <Wallet size={25} />
          <h3>{empty}</h3>
          <p>
            Only SOL and classic SPL tokens are supported. Token-2022, NFTs with
            special custody, staking, and swaps are excluded.
          </p>
        </div>
      )}
    </div>
  );
}
export default function VaultApp() {
  return (
    <WalletProvider>
      <App />
    </WalletProvider>
  );
}
