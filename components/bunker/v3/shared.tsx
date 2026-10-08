"use client";
import "@/sdk/polyfill";
import { useEffect, useRef, useState } from "react";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { LoaderCircle } from "lucide-react";
import type { BunkerConfig } from "@/lib/bunker-config";
import { createConnection, send } from "@/sdk/client";
import { useWallet } from "../wallet";
const friendly: [RegExp, string][] = [
  [
    /\b503\b|RPC unavailable|fetch failed|Failed to fetch/,
    "The Solana connection is unavailable. Nothing was sent. Try again in a moment.",
  ],
  [/User rejected|rejected the request/i, "Declined in your wallet. Nothing was sent."],
  [/Invalid public key input|Non-base58 character/, "That is not a valid Solana address."],
];
export const errorText = (e: unknown) => {
  const m = e instanceof Error ? e.message : "The operation could not be completed.";
  return friendly.find(([pattern]) => pattern.test(m))?.[1] ?? m;
};
/** Config, connection, wallet and a single-flight task runner shared by the
 * protocol 3 vault and recovery tool. */
export function useBunker() {
  const wallet = useWallet();
  const [config, setConfig] = useState<BunkerConfig | null>(null);
  const [connection] = useState(createConnection);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const inFlight = useRef(false);
  useEffect(() => {
    fetch("/api/config")
      .then((r) => {
        if (!r.ok) throw new Error("Cannot load network configuration");
        return r.json() as Promise<BunkerConfig>;
      })
      .then(setConfig)
      .catch((e) => setError(errorText(e)));
  }, []);
  async function task(label: string, fn: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy("");
      inFlight.current = false;
    }
  }
  /** Test custody, with a wallet connected to pay fees. */
  function live() {
    if (!config?.custodyEnabled || !config.programId)
      throw new Error(config?.releaseStatus ?? "Configuration unavailable");
    if (!wallet.address) throw new Error("Connect a wallet to pay network fees");
    return { c: config, program: new PublicKey(config.programId), payer: wallet.address };
  }
  async function transmit(label: string, ixs: TransactionInstruction[]) {
    const { c, payer } = live();
    setBusy(label);
    return send(connection, c, payer, ixs, wallet.sign);
  }
  const enabled = !!config?.custodyEnabled;
  return { wallet, config, connection, busy, error, notice, setError, setNotice, task, live, transmit, enabled };
}
export function Messages({ busy, error, notice }: { busy: string; error: string; notice: string }) {
  return (
    <>
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
    </>
  );
}
export function NetworkPill({ config }: { config: BunkerConfig | null }) {
  return (
    <span className="pill">
      {config?.network === "mainnet-beta"
        ? "MAINNET · READ ONLY"
        : config?.network === "localnet"
          ? "LOCAL TEST NETWORK"
          : config
            ? "DEVNET · TEST ASSETS"
            : "CONNECTING"}
    </span>
  );
}
export function PasswordField({
  label = "Password",
  value,
  onChange,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="password"
        aria-label={label}
        autoComplete="new-password"
        minLength={12}
        placeholder="At least 12 characters"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
export function FileField({
  label,
  onFile,
  disabled,
}: {
  label: string;
  onFile: (f: File | null) => void;
  disabled?: boolean;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        aria-label={label}
        type="file"
        accept=".json,application/json"
        disabled={disabled}
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
    </label>
  );
}
export async function readKeyFile(f: File | null): Promise<string> {
  if (!f) throw new Error("Choose a key file");
  if (f.size > 6000) throw new Error("Key file is too large");
  return f.text();
}
