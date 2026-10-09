"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha256";
import { RefreshCw, LockKeyhole } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { formatAmount, hex, parseAmount, unhex } from "@/sdk/bytes";
import {
  Asset,
  assets,
  depositIxs,
  explorer,
  UnconfirmedError,
  withdrawalDestination,
} from "@/sdk/client";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddress,
} from "@/sdk/classic-token";
import { mintLabel } from "@/sdk/known-mints";
import { feePreflight, withdrawalPreflight } from "@/sdk/preflight";
import { chainTime, fetchVault, formatDuration, toTrusted, vaultTokens } from "@/sdk/v3/chain";
import { Activity, ACTIVITY_LABEL, fetchHistory } from "@/sdk/v3/history";
import {
  authorizeAnnouncement,
  notePayer,
  readJournal,
  safeJournalStatus,
  SignedAnnouncement,
} from "@/sdk/v3/journal";
import { DayKey, decryptDayKey, descriptorOf } from "@/sdk/v3/kit";
import {
  forgetPasskey,
  openPasskey,
  passkeyAvailable,
  PasskeyRecord,
  savePasskey,
  storedPasskeys,
} from "@/sdk/v3/passkey";
import {
  announceIx,
  closeProofIx,
  computeIx,
  decodeAnnounce,
  executeIx,
  expireIx,
  proofAddress,
  executeWindowSecs,
  MAX_ANNOUNCE_AHEAD_SECS,
  pendingPhase,
  stageIxs,
  VaultState,
} from "@/sdk/v3/protocol";
import { BIcon } from "../icon";
import { WalletButton, WalletProvider } from "../wallet";
import { FileField, Messages, NetworkPill, PasswordField, readKeyFile, useBunker } from "./shared";
/** How long a signed announcement has to land. Missing it is recoverable. */
const ANNOUNCE_WINDOW_SECS = 3600n;
type Loaded = {
  state: VaultState;
  spendable: bigint;
  tokens: Asset[];
  now: bigint;
  at: number;
};
/** The deadline for an announcement to land. Counted from whichever clock is
 * later, the chain's or this device's, so a chain clock that runs behind does
 * not produce a deadline already in the past; never further ahead of the
 * chain than the program allows. */
function announceBy(chainNow: bigint): bigint {
  const device = BigInt(Math.floor(Date.now() / 1000));
  const by = (device > chainNow ? device : chainNow) + ANNOUNCE_WINDOW_SECS;
  const limit = chainNow + MAX_ANNOUNCE_AHEAD_SECS;
  return by < limit ? by : limit;
}
const tokenName = (mint: string) => mintLabel(mint) ?? `${mint.slice(0, 4)}…${mint.slice(-4)}`;
/** Exactly what the review screen shows and what gets signed. Built once,
 * when the withdrawal is reviewed, and never recomputed from the form. */
type Intent = {
  kind: 0 | 1;
  mint: PublicKey;
  name: string;
  decimals: number;
  amount: bigint;
  /** The wallet the user typed. */
  recipient: string;
  /** The account that is signed: the wallet for SOL, its token account otherwise. */
  destination: PublicKey;
  /** The key this was reviewed against. If the Bunker has moved on by the
   * time it is signed, the review no longer describes what would happen. */
  epoch: bigint;
  opIndex: bigint;
  /** Whether it leaves at once: no waiting period, or a trusted address. */
  instant: boolean;
  /** Whether the recipient is one of this Bunker's trusted addresses. */
  trusted: boolean;
};
type Step = "idle" | "open" | "deposit" | "withdraw" | "review" | "sweep";
/** Left in the wallet by a sweep so it can still pay fees. */
const SWEEP_KEEP_LAMPORTS = 20_000_000n;
const signed = (n: bigint, decimals: number) =>
  `${n > 0n ? "+" : "−"}${formatAmount(n < 0n ? -n : n, decimals)}`;
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
  // "SOL" or a mint address.
  const [assetKey, setAssetKey] = useState("SOL");
  const [walletAssets, setWalletAssets] = useState<Asset[]>([]);
  // Assets left out of a sweep, by key.
  const [skipped, setSkipped] = useState<string[]>([]);
  const [history, setHistory] = useState<Activity[] | null>(null);
  // Passkey unlock: whether the device can do it, and what is saved here.
  const [canPasskey, setCanPasskey] = useState(false);
  const [passkeys, setPasskeys] = useState<PasskeyRecord[]>([]);
  const [intent, setIntent] = useState<Intent | null>(null);
  const scope =
    b.config?.programId && b.enabled
      ? { genesis: b.config.expectedGenesis, program: b.config.programId }
      : null;
  const scopeKey = scope ? `${scope.genesis}:${scope.program}` : "";
  useEffect(() => {
    if (!scopeKey) return;
    const [genesis, program] = scopeKey.split(":");
    void passkeyAvailable().then((available) => {
      setCanPasskey(available);
      setPasskeys(storedPasskeys({ genesis, program }));
    });
  }, [scopeKey]);
  const [recipient, setRecipient] = useState("");
  const [ack, setAck] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setWall(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const load = useCallback(
    async (key: DayKey) => {
      if (!b.config?.programId) return null;
      const [v, tokens, now] = await Promise.all([
        fetchVault(b.connection, new PublicKey(b.config.programId), new PublicKey(key.vault)),
        vaultTokens(b.connection, new PublicKey(key.vault)),
        chainTime(b.connection),
      ]);
      // The trusted addresses and the waiting period are fixed for the life
      // of a Bunker and are in the day key. Every read is held to them, so a
      // connection that reports others can never put its own address on the
      // trusted list this page shows.
      if (
        key.trusted.length !== v.state.trusted.length ||
        key.trusted.some((t, i) => t !== v.state.trusted[i].toBase58()) ||
        key.delaySecs !== v.state.delaySecs
      )
        throw new Error(
          "The network reports different trusted addresses or a different waiting period from the ones this Bunker was built with. Nothing was done. Try again later or on another connection.",
        );
      const loaded = { state: v.state, spendable: v.spendable, tokens, now, at: Date.now() };
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
      ? safeJournalStatus(day, vault.state)
      : ({ state: "unused" } as const);
  const unfinished = journal.state === "signed" ? journal.announcement : null;
  // What is not already promised to a pending withdrawal.
  const available =
    vault && pending?.kind === 0
      ? vault.spendable > pending.amount
        ? vault.spendable - pending.amount
        : 0n
      : (vault?.spendable ?? 0n);
  /** A pending or announced amount in the units of its own asset. */
  const describe = (kind: number, mint: PublicKey, raw: bigint) => {
    if (kind === 0) return sol(raw);
    const t = vault?.tokens.find((x) => x.mint === mint.toBase58());
    return `${t ? formatAmount(raw, t.decimals) : raw.toString()} ${tokenName(mint.toBase58())}`;
  };
  function close() {
    setStep("idle");
    setFile(null);
    setPassword("");
    setFresh(false);
    setAmount("");
    setAssetKey("SOL");
    setSkipped([]);
    setRecipient("");
    setAck(false);
    setIntent(null);
    b.setError("");
  }
  const loadWallet = () => {
    if (b.wallet.address)
      void assets(b.connection, b.wallet.address)
        .then(setWalletAssets)
        .catch(() => setWalletAssets([]));
  };
  async function loadHistory() {
    const { program } = b.live();
    if (!day) throw new Error("Open your Bunker first");
    setHistory(await fetchHistory(b.connection, program, new PublicKey(day.vault)));
  }
  /** Bunker Mode: move what the wallet holds into the Bunker. */
  async function sweep() {
    const { payer } = b.live();
    if (!day) throw new Error("Open your Bunker first");
    const vaultKey = new PublicKey(day.vault);
    // Read the wallet again: amounts must be what is there now.
    const held = await assets(b.connection, payer);
    // Only what was on the list the user looked at. Something that arrived in
    // the wallet since then is left where it is.
    const shown = new Set(walletAssets.map((a) => a.mint));
    const tokens = held.filter(
      (a) =>
        a.mint && shown.has(a.mint) && a.amount > 0n && !a.frozen && !skipped.includes(a.mint),
    );
    const batches: Awaited<ReturnType<typeof depositIxs>>[] = [];
    for (let i = 0; i < tokens.length; i += 3)
      batches.push(
        (
          await Promise.all(
            tokens.slice(i, i + 3).map((a) => depositIxs(payer, vaultKey, a, a.amount)),
          )
        ).flat(),
      );
    const total = batches.length + (skipped.includes("SOL") ? 0 : 1);
    let moved = 0;
    for (const ixs of batches)
      await b.transmit(`Moving in · ${++moved} of ${total}`, ixs);
    if (!skipped.includes("SOL")) {
      // Last, so fees and token-account deposits above are already paid.
      // Also leave this transfer's own fee, so the wallet ends on the reserve.
      const lamports =
        BigInt(await b.connection.getBalance(payer)) - SWEEP_KEEP_LAMPORTS - 5_000n;
      if (lamports > 0n)
        await b.transmit(`Moving in · ${++moved} of ${total}`, [
          SystemProgram.transfer({ fromPubkey: payer, toPubkey: vaultKey, lamports }),
        ]);
    }
    close();
    await load(day);
    setHistory(null);
    b.setNotice(
      moved > 0
        ? "Bunker Mode on. What you selected is inside, and this wallet’s key cannot take it back out. Seal when you are done."
        : "Nothing was moved: there was nothing selected beyond the SOL this wallet keeps for fees.",
    );
  }
  function seal() {
    setDay(null);
    setVault(null);
    setHistory(null);
    close();
    b.setNotice("Bunker sealed. The day key is no longer in this browser tab.");
  }
  /** Checks a day key against the chain and puts it in the tab. */
  async function admit(key: DayKey) {
    const { c, program } = b.live();
    if (key.program !== program.toBase58() || key.genesis !== c.expectedGenesis)
      throw new Error("This day key belongs to a different network or program");
    const loaded = await load(key);
    if (!loaded) throw new Error("Configuration unavailable");
    if (BigInt(key.epoch) > loaded.state.epoch)
      throw new Error(
        `This day key is for key generation ${key.epoch}, and your Bunker is still on generation ${loaded.state.epoch}. Submit the recovery packet on the Recovery page first; this key works once it lands.`,
      );
    if (BigInt(key.epoch) !== loaded.state.epoch)
      throw new Error(
        `This day key (generation ${key.epoch}) has been replaced. Your Bunker is on generation ${loaded.state.epoch}: use that day key, or re-issue it in the recovery tool.`,
      );
    // Signing needs both; say so now, not after a withdrawal has been reviewed.
    if (!navigator.locks)
      throw new Error(
        "This browser cannot coordinate tabs safely (no Web Locks), so withdrawals cannot be signed here. Use a current version of Safari, Chrome or Firefox outside a wallet’s built-in browser.",
      );
    try {
      localStorage.setItem("bunker3-storage-check", "1");
      localStorage.removeItem("bunker3-storage-check");
    } catch {
      throw new Error(
        "This browser is not letting the page store anything (private mode or blocked site data), so it cannot keep the record that stops a key being used twice. Open your Bunker in a normal window.",
      );
    }
    // Ask the browser not to evict this site's storage: the record of what
    // has been signed lives there.
    void navigator.storage?.persist?.().catch(() => false);
    setDay(key);
    close();
  }
  async function unsealWithPasskey(r: PasskeyRecord) {
    if (!scope) throw new Error("Configuration unavailable");
    // The same day key also exists as a file, and may have been used in
    // another browser. The statement is needed however the key is opened.
    if (!fresh)
      throw new Error(
        "Confirm that this day key has not started a withdrawal on another device.",
      );
    try {
      await admit(await openPasskey(scope, r));
    } catch (e) {
      // A day key that recovery has replaced will never open again: stop
      // offering it.
      if (e instanceof Error && e.message.includes("has been replaced")) {
        forgetPasskey(scope, r);
        setPasskeys(storedPasskeys(scope));
        throw new Error(
          `${e.message} The passkey copy saved in this browser was for the old key and has been removed. Open your Bunker with the new day key file; you can save a passkey for it afterwards.`,
        );
      }
      throw e;
    }
    b.setNotice("Unsealed with your passkey. The day key is in this tab until you seal it.");
  }
  async function rememberWithPasskey() {
    if (!day) throw new Error("Open your Bunker first");
    await savePasskey(day);
    if (scope) setPasskeys(storedPasskeys(scope));
    b.setNotice(
      "Saved. Next time, unseal with your passkey in this browser. This is not a backup: your recovery kit still replaces a lost key.",
    );
  }
  function removePasskey(r: PasskeyRecord) {
    if (!scope) return;
    forgetPasskey(scope, r);
    setPasskeys(storedPasskeys(scope));
    b.setNotice(
      `Passkey unlock removed from this browser. You can also delete “Bunker ${r.vault.slice(0, 8)}” from your device’s passkey manager.`,
    );
  }
  async function unseal() {
    const key = await decryptDayKey(await readKeyFile(file), password);
    // This browser cannot know whether the key signed something elsewhere that
    // has not landed yet. The user has to say, every time it is opened.
    if (!fresh)
      throw new Error(
        "Confirm that this day key has not started a withdrawal on another device.",
      );
    await admit(key);
    b.setNotice("Unsealed. The day key is in this tab until you seal it.");
  }
  async function deposit() {
    const { payer } = b.live();
    if (!day) throw new Error("Open your Bunker first");
    const vaultKey = new PublicKey(day.vault);
    try {
      if (assetKey === "SOL") {
        const lamports = parseAmount(amount, 9);
        if (lamports <= 0n) throw new Error("Enter an amount");
        await b.transmit("Depositing", [
          SystemProgram.transfer({ fromPubkey: payer, toPubkey: vaultKey, lamports }),
        ]);
      } else {
        // A wallet can hold one mint in several accounts: the one chosen is
        // the one used, not the first with that mint.
        const asset = walletAssets.find((a) => a.account === assetKey);
        if (!asset) throw new Error("That token is not in the connected wallet");
        // Creates the Bunker's token account for this mint if it does not exist.
        await b.transmit(
          "Depositing",
          await depositIxs(payer, vaultKey, asset, parseAmount(amount, asset.decimals)),
        );
      }
    } catch (e) {
      // Sent but unconfirmed: clear the form so it is not simply pressed
      // again, and show the balance as it now is.
      if (e instanceof UnconfirmedError) {
        close();
        await load(day).catch(() => null);
      }
      throw e;
    }
    close();
    await load(day);
    b.setNotice("Deposit confirmed.");
  }
  /** Whether a withdrawal to this destination waits. The program decides; this
   * is the same rule, so the review can say what will happen. */
  async function timing(w: { kind: 0 | 1; mint: PublicKey; destination: PublicKey }) {
    if (!vault) throw new Error("Open your Bunker first");
    const trusted = await toTrusted(vault.state, w);
    return { trusted, instant: trusted || vault.state.delaySecs === 0 };
  }
  async function review() {
    if (!day || !vault) throw new Error("Open your Bunker first");
    const { payer } = b.live();
    if (pending) throw new Error("Finish or cancel the pending withdrawal first");
    const to = new PublicKey(recipient.trim());
    if (!PublicKey.isOnCurve(to.toBytes()) || to.toBase58() === day.vault)
      throw new Error("Use a normal wallet address outside this Bunker");
    // One asset, read once. Everything below, the review screen and the
    // signature all use this value and nothing from the form again.
    const chosen = assetKey === "SOL" ? null : vault.tokens.find((t) => t.mint === assetKey);
    if (chosen === undefined) throw new Error("That token is not in the Bunker");
    if (!chosen) {
      const lamports = parseAmount(amount, 9);
      if (lamports <= 0n || lamports > available)
        throw new Error(`Enter an amount up to ${sol(available)}`);
      // Things the network would reject, found before a key is used.
      await withdrawalPreflight(
        b.connection,
        payer,
        to,
        to,
        { key: "SOL", mint: null, account: null, label: "SOL", amount: available, decimals: 9, frozen: false },
        lamports,
      );
      setIntent({
        kind: 0,
        mint: PublicKey.default,
        name: "SOL",
        decimals: 9,
        amount: lamports,
        recipient: to.toBase58(),
        destination: to,
        epoch: vault.state.epoch,
        opIndex: vault.state.opIndex,
        ...(await timing({ kind: 0, mint: PublicKey.default, destination: to })),
      });
    } else {
      const qty = parseAmount(amount, chosen.decimals);
      if (qty <= 0n || qty > chosen.amount || chosen.frozen)
        throw new Error(
          chosen.frozen
            ? "This token account is frozen by its issuer"
            : `Enter an amount up to ${formatAmount(chosen.amount, chosen.decimals)}`,
        );
      // Confirms the mint is a classic SPL mint, that the recipient's token
      // account is usable, and that the fee wallet can pay for the withdrawal.
      const dest = await withdrawalDestination(b.connection, payer, to, chosen);
      await withdrawalPreflight(b.connection, payer, to, dest.destination, chosen, qty);
      setIntent({
        kind: 1,
        mint: new PublicKey(chosen.mint!),
        name: tokenName(chosen.mint!),
        decimals: chosen.decimals,
        amount: qty,
        recipient: to.toBase58(),
        // The exact token account is what gets signed.
        destination: dest.destination,
        epoch: vault.state.epoch,
        opIndex: vault.state.opIndex,
        ...(await timing({
          kind: 1,
          mint: new PublicKey(chosen.mint!),
          destination: dest.destination,
        })),
      });
    }
    setStep("review");
  }
  async function publish(signed: SignedAnnouncement) {
    const { program, payer } = b.live();
    if (!day) throw new Error("Open your Bunker first");
    const a = decodeAnnounce(signed.payload);
    // Read the vault now: the key being retired is named from the chain as it
    // is at this moment, not from what the page last rendered.
    const current = await load(day);
    if (!current) throw new Error("Configuration unavailable");
    const { state } = current;
    const landed = (s: VaultState) => s.epoch === a.epoch && s.opIndex > a.opIndex;
    const done = (s: VaultState) => {
      close();
      b.setNotice(
        s.pending
          ? "Withdrawal announced. Nothing has moved. It can be released when the waiting period ends."
          : "Withdrawal sent. It reached its destination and the key was replaced.",
      );
    };
    // Already on-chain (an earlier attempt landed without being confirmed).
    if (landed(state)) return done(state);
    if (state.epoch !== a.epoch || state.opIndex !== a.opIndex || state.pending)
      throw new Error(
        "Your Bunker’s keys were replaced after this withdrawal was signed, so it can no longer be announced. Nothing moved.",
      );
    // Three approvals follow. Do not start if the wallet cannot finish them.
    await feePreflight(b.connection, payer);
    // The upload lives at an address derived from this wallet; remember which.
    await notePayer(day, { epoch: a.epoch, opIndex: a.opIndex }, payer.toBase58()).catch(
      () => undefined,
    );
    const instant = state.delaySecs === 0 || (await toTrusted(state, a));
    const vaultKey = new PublicKey(day.vault);
    // For a token, make sure the recipient's token account exists (now, so it
    // is there when a waiting withdrawal is released) and name the Bunker's own.
    let setup: ReturnType<typeof createAssociatedTokenAccountIdempotentInstruction>[] = [];
    let source: PublicKey | undefined;
    if (a.kind === 1) {
      if (!signed.recipient) throw new Error("Recipient wallet for this token is unknown");
      source = await getAssociatedTokenAddress(a.mint, vaultKey, true);
      setup = [
        createAssociatedTokenAccountIdempotentInstruction(
          payer,
          a.destination,
          new PublicKey(signed.recipient),
          a.mint,
        ),
      ];
    }
    try {
      const stages = stageIxs(program, payer, signed.message, signed.signature);
      for (let i = 0; i < stages.length; i++)
        await b.transmit(`Approval ${i + 1} of 3 · publishing your authorization`, [stages[i]]);
      await b.transmit(
        instant
          ? "Approval 3 of 3 · sending the withdrawal"
          : "Approval 3 of 3 · announcing the withdrawal",
        [
          computeIx(),
          announceIx(program, payer, signed.payload, state.opRoot),
          ...setup,
          // With no waiting period the withdrawal is released in the same
          // transaction; either both happen or neither does.
          ...(instant
            ? [
                executeIx(
                  program,
                  vaultKey,
                  { kind: a.kind, mint: a.mint, destination: a.destination },
                  source,
                ),
              ]
            : []),
          closeProofIx(program, payer, signed.message),
        ],
      );
    } catch (e) {
      // The key has signed. Whatever went wrong, leave the review screen so
      // the same withdrawal cannot be signed a second time from it, and look
      // at the chain: an approval that timed out may still have landed.
      close();
      // An unconfirmed step may land a moment later: look more than once.
      for (let attempt = 0; attempt < (e instanceof UnconfirmedError ? 6 : 1); attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));
        const after = await load(day).catch(() => null);
        if (after && landed(after.state)) return done(after.state);
      }
      throw e;
    }
    const after = await load(day);
    done(after ? after.state : state);
  }
  async function announce() {
    if (!day) throw new Error("Open your Bunker first");
    if (!ack) throw new Error("Confirm you checked the recipient and amount");
    const current = await load(day);
    if (!current) throw new Error("Configuration unavailable");
    if (BigInt(day.epoch) !== current.state.epoch)
      throw new Error("This day key has been replaced. Open the newest one.");
    // Signing happens against the key the review was made for, or not at all.
    // If the Bunker has moved on, an earlier attempt may already have landed.
    if (
      intent &&
      (intent.epoch !== current.state.epoch || intent.opIndex !== current.state.opIndex)
    ) {
      close();
      throw new Error(
        "Your Bunker changed after you reviewed this withdrawal, so it was not signed. A withdrawal may already have gone through: check the balance and activity before starting another.",
      );
    }
    if (!intent) throw new Error("Review the withdrawal first");
    const signed = await authorizeAnnouncement(
      day,
      unhex(day.seed),
      descriptorOf(day),
      current.state,
      {
        kind: intent.kind,
        mint: intent.mint,
        destination: intent.destination,
        amount: intent.amount,
        announceBy: announceBy(current.now),
        // Signed, and checked by the program against the mint.
        decimals: intent.kind === 1 ? intent.decimals : 0,
      },
      intent.kind === 1 ? intent.recipient : undefined,
    );
    await publish(signed);
  }
  async function release() {
    const { program, payer } = b.live();
    if (!day || !pending) throw new Error("Nothing to release");
    const vaultKey = new PublicKey(day.vault);
    const setup: ReturnType<typeof createAssociatedTokenAccountIdempotentInstruction>[] = [];
    if (pending.kind === 1) {
      // The recipient's token account was created when this was announced. If
      // it has since been closed, the release would fail with no explanation.
      const there = await b.connection.getAccountInfo(pending.destination);
      if (!there) {
        // This browser knows whose account it was only if it signed the withdrawal.
        const recipient = (() => {
          try {
            return readJournal(day).entries.find(
              (e) => e.payload && hex(decodeAnnounce(unhex(e.payload)).destination.toBytes()) === hex(pending.destination.toBytes()),
            )?.recipient;
          } catch {
            return undefined;
          }
        })();
        if (!recipient)
          throw new Error(
            "The recipient’s token account for this withdrawal no longer exists, so it cannot be released yet. The recipient can recreate it by receiving any amount of this token, after which Release will work; or cancel the withdrawal with your recovery kit. Nothing has left your Bunker.",
          );
        setup.push(
          createAssociatedTokenAccountIdempotentInstruction(
            payer,
            pending.destination,
            new PublicKey(recipient),
            pending.mint,
          ),
        );
      }
    }
    await b.transmit("Releasing", [
      ...setup,
      executeIx(
        program,
        vaultKey,
        pending,
        pending.kind === 1
          ? await getAssociatedTokenAddress(pending.mint, vaultKey, true)
          : undefined,
      ),
    ]);
    await load(day);
    b.setNotice("Released. The withdrawal reached its destination.");
  }
  /** Takes back the deposit on a signature upload that will never be used. */
  async function reclaim(signed: SignedAnnouncement) {
    const { program, payer } = b.live();
    const proof = proofAddress(program, payer, sha256(signed.message));
    if (!(await b.connection.getAccountInfo(proof)))
      throw new Error(
        "There is no upload deposit to take back with this wallet. If you started the withdrawal with a different wallet, connect that one.",
      );
    await b.transmit("Taking back the deposit", [closeProofIx(program, payer, signed.message)]);
    b.setNotice("Deposit returned to your wallet.");
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
          label: "Unavailable",
          line: "This site is not set up to reach a Bunker program.",
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
              <dd>
                {!vault
                  ? "—"
                  : vault.state.delaySecs
                    ? vault.state.trusted.length
                      ? `${formatDuration(BigInt(vault.state.delaySecs))}, except to trusted addresses`
                      : formatDuration(BigInt(vault.state.delaySecs))
                    : "None"}
              </dd>
            </div>
            {vault && vault.state.trusted.length > 0 && (
              <div>
                <dt>Trusted addresses</dt>
                <dd>
                  {vault.state.trusted.map((t) => (
                    <code key={t.toBase58()} title={t.toBase58()} className="trusted-address">
                      {t.toBase58()}
                    </code>
                  ))}
                </dd>
              </div>
            )}
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
            <h2>Not available here.</h2>
            <p>This site is not set up to reach a Bunker program.</p>
            <Link href="/verify">See the deployment</Link>
          </div>
          <span className="pill">UNAVAILABLE</span>
        </div>
      ) : (
        <div className="notice">
          <BIcon name="simulation" size={18} />
          <span>
            {b.config.network === "mainnet-beta"
              ? "Public beta on Solana mainnet. Not audited. Put in only what you could afford to lose."
              : "Test network. Nothing here holds real funds."}
          </span>
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
                  <dd className="review-amount">
                    {describe(pending.kind, pending.mint, pending.amount)}
                  </dd>
                </div>
                <div>
                  <dt>
                    {pending.kind === 0 ? "To" : "To the recipient’s token account"}
                    {phase === "waiting" && vault.state.trusted.length > 0 && (
                      <em className="not-trusted"> · not one of your trusted addresses</em>
                    )}
                  </dt>
                  <dd>
                    <code>{pending.destination.toBase58()}</code>
                    {pending.kind === 1 && (
                      <small>
                        {" "}
                        Tokens are held in a token account that belongs to the recipient’s wallet,
                        so this is not the wallet address you typed.
                      </small>
                    )}
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
                    Not you? Stop it with your cancel file
                  </Link>
                )}
              </div>
              <p className="micro">
                {phase === "waiting"
                  ? "Nothing has left your Bunker. Your cancel file stops this at once; so does a recovery packet made with your recovery kit. Either one retires this day key."
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
                  : `${describe(decodeAnnounce(unfinished.payload).kind, decodeAnnounce(unfinished.payload).mint, decodeAnnounce(unfinished.payload).amount)} to ${unfinished.recipient ?? decodeAnnounce(unfinished.payload).destination.toBase58()} was signed but not announced. Finishing sends the same authorization.`}
              </p>
              {unfinished.payer &&
                b.wallet.address &&
                unfinished.payer !== b.wallet.address.toBase58() && (
                  <p className="micro wait-hint">
                    This was started with wallet {unfinished.payer.slice(0, 4)}…
                    {unfinished.payer.slice(-4)}. Reconnect that wallet to reuse the upload it
                    already paid for and get its deposit back. With this wallet it still works,
                    but pays for the upload again.
                  </p>
                )}
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
                {unfinishedExpired && (
                  <button
                    className="button ghost"
                    disabled={!can}
                    onClick={() => b.task("Checking", () => reclaim(unfinished))}
                  >
                    Take back the upload deposit
                  </button>
                )}
                <Link className="button ghost" href="/recovery">
                  Open the recovery tool
                </Link>
              </div>
            </section>
          )}
          {(journal.state === "behind" || journal.state === "unreadable") && (
            <div className="error-box app-message" role="alert">
              {journal.state === "behind"
                ? "The network is showing an older state of your Bunker than this browser has already signed for. Withdrawals are paused here so a key is never used twice. Refresh; if it stays, install new keys in the "
                : "This browser’s record of what it has signed cannot be read, so it will not sign. If this key may have signed a withdrawal that never arrived, install new keys in the "}
              <Link href="/recovery">recovery tool</Link>. Your assets have not moved.
            </div>
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
            <section className="panel balance-panel is-open">
              <div className="panel-head">
                <span className="eyebrow">INSIDE</span>
                <BIcon name="vault" size={22} />
              </div>
              <span className="balance-label">Available · rent reserve excluded</span>
              <div className="vault-balance">
                {formatAmount(available, 9)}
                <span>SOL</span>
              </div>
              {vault.tokens.length > 0 && (
                <ul className="token-rows">
                  {vault.tokens.map((t) => (
                    <li key={t.account}>
                      <span>
                        <b>{tokenName(t.mint!)}</b>
                        {t.frozen && <em>Frozen</em>}
                      </span>
                      <code title={t.mint!}>{formatAmount(t.amount, t.decimals)}</code>
                    </li>
                  ))}
                </ul>
              )}
              <div className="vault-address">
                <span>Bunker address</span>
                <code>{day.vault}</code>
              </div>
              {step === "deposit" ? (
                <div className="inline-form">
                  <label className="field">
                    <span>Asset</span>
                    <select
                      aria-label="Asset"
                      value={assetKey}
                      onChange={(e) => setAssetKey(e.target.value)}
                    >
                      <option value="SOL">SOL</option>
                      {walletAssets
                        .filter((a) => a.mint && a.amount > 0n && !a.frozen)
                        .map((a) => (
                          <option key={a.account} value={a.account!}>
                            {tokenName(a.mint!)} · {formatAmount(a.amount, a.decimals)} in wallet
                          </option>
                        ))}
                    </select>
                    <small>SOL and classic SPL tokens. Token-2022 is not supported.</small>
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
              ) : step === "sweep" ? (
                <div className="inline-form">
                  <h2>Go Bunker Mode.</h2>
                  <p className="modal-copy">
                    Move what this wallet holds into your Bunker in one go.
                    Once inside, it only comes out with your Bunker key.
                  </p>
                  <ul className="sweep-list">
                    {walletAssets
                      .filter((a) => a.amount > 0n && !a.frozen)
                      .map((a) => {
                        const id = a.mint ?? "SOL";
                        const moving = a.mint
                          ? a.amount
                          : a.amount > SWEEP_KEEP_LAMPORTS
                            ? a.amount - SWEEP_KEEP_LAMPORTS
                            : 0n;
                        return (
                          <li key={a.key}>
                            <label className="check-label">
                              <Checkbox
                                aria-label={`Move ${a.mint ? tokenName(a.mint) : "SOL"}`}
                                checked={!skipped.includes(id)}
                                onCheckedChange={(v) =>
                                  setSkipped((old) =>
                                    v === true ? old.filter((k) => k !== id) : [...old, id],
                                  )
                                }
                              />
                              <span>
                                <b>{a.mint ? tokenName(a.mint) : "SOL"}</b>
                              </span>
                            </label>
                            <code>{formatAmount(moving, a.decimals)}</code>
                          </li>
                        );
                      })}
                  </ul>
                  <p className="micro">
                    {formatAmount(SWEEP_KEEP_LAMPORTS, 9)} SOL stays in the
                    wallet for fees. SOL and classic SPL tokens only. One
                    wallet approval per group of three tokens, then one for
                    SOL.
                  </p>
                  <div className="actions">
                    <button
                      className="button light"
                      disabled={!can || walletAssets.length === 0}
                      onClick={() => b.task("Moving in", sweep)}
                    >
                      Move it all in
                    </button>
                    <button className="button ghost" onClick={close}>
                      Back
                    </button>
                  </div>
                </div>
              ) : step === "withdraw" ? (
                <div className="inline-form">
                  <h2>Withdraw.</h2>
                  <label className="field">
                    <span>Asset</span>
                    <select
                      aria-label="Asset"
                      value={assetKey}
                      disabled={!!b.busy}
                      onChange={(e) => setAssetKey(e.target.value)}
                    >
                      <option value="SOL">SOL · {formatAmount(available, 9)} available</option>
                      {vault.tokens
                        .filter((t) => t.amount > 0n)
                        .map((t) => (
                          <option key={t.account} value={t.mint!} disabled={t.frozen}>
                            {tokenName(t.mint!)} · {formatAmount(t.amount, t.decimals)}
                            {t.frozen ? " (frozen)" : ""}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Amount</span>
                    <input
                      inputMode="decimal"
                      placeholder="0.00"
                      value={amount}
                      disabled={!!b.busy}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="link-button field-aside"
                    disabled={!!b.busy}
                    onClick={() => {
                      const token = vault.tokens.find((t) => t.mint === assetKey);
                      setAmount(
                        token
                          ? formatAmount(token.amount, token.decimals)
                          : formatAmount(available, 9),
                      );
                    }}
                  >
                    Use everything available
                  </button>
                  <label className="field">
                    <span>Recipient wallet address</span>
                    <input
                      disabled={!!b.busy}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="Solana wallet address"
                      value={recipient}
                      onChange={(e) => setRecipient(e.target.value)}
                    />
                  </label>
                  {recipient.trim() && vault.state.delaySecs > 0 && (
                    <p
                      className={`micro wait-hint ${vault.state.trusted.some((t) => t.toBase58() === recipient.trim()) ? "is-trusted" : ""}`}
                      role="status"
                    >
                      {vault.state.trusted.some((t) => t.toBase58() === recipient.trim())
                        ? "A trusted address: this arrives as soon as you approve it."
                        : `Not a trusted address: this waits ${formatDuration(BigInt(vault.state.delaySecs))} before it can leave, and you can cancel it during that time.`}
                    </p>
                  )}
                  {vault.state.trusted.length > 0 && (
                    <div className="trusted-picks">
                      <small>
                        {vault.state.delaySecs
                          ? "Trusted addresses, no wait:"
                          : "Trusted addresses:"}
                      </small>
                      {vault.state.trusted.map((t) => (
                        <button
                          key={t.toBase58()}
                          type="button"
                          className="link-button"
                          disabled={!!b.busy}
                          title={t.toBase58()}
                          onClick={() => setRecipient(t.toBase58())}
                        >
                          {t.toBase58().slice(0, 6)}…{t.toBase58().slice(-6)}
                        </button>
                      ))}
                    </div>
                  )}
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
              ) : step === "review" && intent ? (
                <div className="inline-form">
                  <dl className="withdraw-review">
                    <div>
                      <dt>You are announcing</dt>
                      <dd className="review-amount">
                        {formatAmount(intent.amount, intent.decimals)} {intent.name}
                      </dd>
                    </div>
                    {intent.kind === 1 && (
                      <div>
                        <dt>Token mint</dt>
                        <dd>
                          <code>{intent.mint.toBase58()}</code>
                        </dd>
                      </div>
                    )}
                    {intent.kind === 1 && (
                      <div>
                        <dt>Exactly what is signed</dt>
                        <dd>
                          <code>{intent.amount.toString()}</code> of the token’s smallest unit
                          <small>
                            {" "}
                            The amount above assumes this token has {intent.decimals} decimal
                            places. That number is signed too, and the program refuses the
                            withdrawal if the token’s real number differs.
                          </small>
                        </dd>
                      </div>
                    )}

                    <div>
                      <dt>To this address</dt>
                      <dd>
                        <code>{intent.recipient}</code>
                      </dd>
                    </div>
                    {intent.instant && intent.trusted && vault.state.delaySecs ? (
                      <div>
                        <dt>When it leaves</dt>
                        <dd>
                          Immediately, on the third approval. This is one of
                          your Bunker’s trusted addresses, so it does not
                          wait and cannot be cancelled once sent.
                        </dd>
                      </div>
                    ) : vault.state.delaySecs ? (
                      <>
                        <div>
                          <dt>It can leave after</dt>
                          <dd>
                            {formatDuration(BigInt(vault.state.delaySecs))} of
                            waiting, then within{" "}
                            {formatDuration(executeWindowSecs(vault.state.delaySecs))}
                          </dd>
                        </div>
                        <div>
                          <dt>Until then</dt>
                          <dd>
                            Nothing moves, and your recovery kit can cancel it.
                          </dd>
                        </div>
                      </>
                    ) : (
                      <div>
                        <dt>When it leaves</dt>
                        <dd>
                          Immediately, on the third approval. This Bunker has
                          no waiting period, so it cannot be cancelled once
                          sent.
                        </dd>
                      </div>
                    )}
                  </dl>
                  <label className="check-label">
                    <Checkbox checked={ack} onCheckedChange={(v) => setAck(v === true)} />
                    <span>
                      I checked the full recipient and amount. Expect 3 wallet
                      approvals.
                    </span>
                  </label>
                  <p className="micro">
                    Signing uses up this Bunker’s current one-time key for exactly this
                    withdrawal. After that it can be finished or cancelled, not changed. If you
                    are interrupted, come back and you will be offered “Finish announcing”.
                  </p>
                  <div className="actions">
                    <button
                      className="button light"
                      disabled={!can || !ack}
                      onClick={() => b.task("Signing", announce)}
                    >
                      {intent.instant ? "Sign and send" : "Sign and announce"}
                    </button>
                    <button
                      className="button ghost"
                      disabled={!!b.busy}
                      onClick={() => {
                        setIntent(null);
                        setAck(false);
                        setStep("withdraw");
                      }}
                    >
                      Back
                    </button>
                  </div>
                </div>
              ) : (
                <div className="actions">
                  <button
                    className="button light"
                    disabled={!can || stale}
                    onClick={() => {
                      close();
                      setStep("deposit");
                      loadWallet();
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
                  <button
                    className="button ghost bunker-mode"
                    disabled={!can || stale}
                    onClick={() => {
                      close();
                      setStep("sweep");
                      setWalletAssets([]);
                      loadWallet();
                    }}
                  >
                    <BIcon name="vault" size={17} />
                    Bunker Mode
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
                <span>Audit</span>
                <b className="amber">None</b>
              </div>
              {canPasskey &&
                !stale &&
                (passkeys.some((p) => p.vault === day.vault && p.epoch === day.epoch) ? (
                  <div className="metric">
                    <span>This browser</span>
                    <b>Unseals with passkey</b>
                  </div>
                ) : (
                  <button
                    className="button ghost passkey-offer"
                    disabled={!!b.busy}
                    onClick={() => b.task("Waiting for your passkey", rememberWithPasskey)}
                  >
                    <BIcon name="bunker-key" size={17} />
                    Unseal with a passkey next time
                  </button>
                ))}
              {b.config?.alertsBot && (
                <a
                  className="button ghost passkey-offer"
                  href={`https://t.me/${b.config.alertsBot}?start=${day.vault}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <BIcon name="alert" size={17} />
                  Get Telegram alerts
                </a>
              )}
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
                    device or browser, or in this one before its site data
                    was cleared or a private window was closed. If unsure,
                    install new keys in the recovery tool first.
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
                    ? "Open your Bunker with its day key, or build a new one with the offline recovery tool."
                    : "Deposits go in from any wallet. Withdrawals to your trusted addresses arrive at once; anything else waits, and you can cancel it."}
                </p>
                {b.enabled && passkeys.length > 0 && (
                  <label className="check-label">
                    <Checkbox checked={fresh} onCheckedChange={(v) => setFresh(v === true)} />
                    <span>
                      This day key has not started a withdrawal on another
                      device or browser, or in this one before its site data
                      was cleared.
                    </span>
                  </label>
                )}
                <div className="actions">
                  {b.enabled && passkeys.length > 0 ? (
                    passkeys.map((p) => (
                      <button
                        key={p.vault}
                        className="button light"
                        disabled={!can || !fresh}
                        onClick={() =>
                          b.task("Waiting for your passkey", () => unsealWithPasskey(p))
                        }
                      >
                        <BIcon name="bunker-key" size={17} />
                        {passkeys.length === 1
                          ? "Unseal with passkey"
                          : `Unseal ${p.vault.slice(0, 4)}…${p.vault.slice(-4)} with passkey`}
                      </button>
                    ))
                  ) : b.enabled ? (
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
                {b.enabled &&
                  passkeys.map((p) => (
                    <p className="micro" key={p.vault}>
                      Passkey unlock saved in this browser for{" "}
                      {p.vault.slice(0, 4)}…{p.vault.slice(-4)}.{" "}
                      <button className="link-button" onClick={() => removePasskey(p)}>
                        Remove
                      </button>
                    </p>
                  ))}
                {b.enabled && passkeys.length > 0 && (
                  <p className="micro">
                    <Link href="/recovery">Build another Bunker</Link>
                  </p>
                )}
                {b.enabled && !b.wallet.address && (
                  <p className="micro">
                    Connect a wallet first. It pays the network fees and has no say over your
                    Bunker; any wallet will do.
                  </p>
                )}
                <span className="micro">
                  {b.config?.network === "mainnet-beta" ? "PUBLIC BETA · NOT AUDITED" : "TEST ASSETS ONLY"}
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
                  <b>Wait, unless it is a trusted address</b>
                  <span>
                    Addresses you fixed when you built the Bunker are paid at once. Anything
                    else waits, and nothing moves while it does.
                  </span>
                </div>
              </li>
              <li>
                <BIcon name="alert" size={18} />
                <div>
                  <b>Cancel if it wasn’t you</b>
                  <span>During a wait, your cancel file stops it and retires this day key.</span>
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
      {day && vault && (
        <section className="panel activity-log">
          <div className="panel-head">
            <h2>Activity</h2>
            <button
              className="text-button"
              disabled={!!b.busy}
              onClick={() => b.task("Reading activity", loadHistory)}
            >
              <RefreshCw size={14} />
              {history ? "Refresh" : "Show activity"}
            </button>
          </div>
          {history === null ? (
            <p className="micro">
              The most recent transactions in or out, read back from the chain.
            </p>
          ) : history.length === 0 ? (
            <p className="micro">Nothing yet.</p>
          ) : (
            <ul>
              {history.map((a) => {
                const link = b.config ? explorer(a.signature, b.config.network) : null;
                return (
                  <li key={a.signature} className={a.failed ? "failed" : ""}>
                    <div>
                      <b>
                        {ACTIVITY_LABEL[a.kind]}
                        {a.failed ? " · failed" : ""}
                      </b>
                      <span>
                        {a.time
                          ? new Date(a.time * 1000).toLocaleString(undefined, {
                              dateStyle: "medium",
                              timeStyle: "short",
                            })
                          : "Time not reported"}
                      </span>
                    </div>
                    <div className="activity-amounts">
                      {!a.failed && a.sol !== 0n && a.kind !== "built" && (
                        <code>{signed(a.sol, 9)} SOL</code>
                      )}
                      {!a.failed &&
                        a.tokens.map((t) => (
                          <code key={t.mint}>
                            {signed(t.delta, t.decimals)} {tokenName(t.mint)}
                          </code>
                        ))}
                    </div>
                    {link ? (
                      <a href={link} target="_blank" rel="noreferrer">
                        Explorer
                      </a>
                    ) : (
                      <code title={a.signature}>{a.signature.slice(0, 8)}…</code>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="micro">
            Shows transactions that name this Bunker’s address. A token sent
            straight to one of its token accounts from elsewhere appears in the
            balance but not here.
          </p>
        </section>
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
