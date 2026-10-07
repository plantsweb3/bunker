"use client";
import "@/sdk/polyfill";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useCallback,
  useMemo,
  ReactNode,
} from "react";
import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { Transaction, PublicKey } from "@solana/web3.js";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Wallet as WalletIcon, LogOut } from "lucide-react";
import { useHydrated } from "./use-hydrated";
import { equal } from "@/sdk/bytes";
type Connect = {
  connect: () => Promise<{ accounts: readonly WalletAccount[] }>;
};
type Events = {
  on: (
    event: "change",
    cb: (p: { accounts?: readonly WalletAccount[] }) => void,
  ) => () => void;
};
type Sign = {
  signTransaction: (input: {
    transaction: Uint8Array;
    account: WalletAccount;
    chain: string;
  }) => Promise<readonly { signedTransaction: Uint8Array }[]>;
};
type Context = {
  ready: boolean;
  address: PublicKey | null;
  name: string | null;
  open: () => void;
  disconnect: () => Promise<void>;
  sign: (tx: Transaction, chain: string) => Promise<Transaction>;
};
const WalletContext = createContext<Context | null>(null);
export function useWallet() {
  const v = useContext(WalletContext);
  if (!v) throw new Error("Wallet provider missing");
  return v;
}
export function WalletProvider({ children }: { children: ReactNode }) {
  const ready = useHydrated();
  const [wallets, setWallets] = useState<readonly Wallet[]>([]);
  const [selected, setSelected] = useState<Wallet | null>(null);
  const [account, setAccount] = useState<WalletAccount | null>(null);
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const current = useRef(account);
  const updateAccount = useCallback((next: WalletAccount | null) => {
    current.current = next;
    setAccount(next);
  }, []);
  const address = useMemo(() => account ? new PublicKey(account.publicKey) : null, [account]);
  useEffect(() => {
    const registry = getWallets();
    const update = () =>
      setWallets(
        registry
          .get()
          .filter(
            (w) =>
              "standard:connect" in w.features &&
              "solana:signTransaction" in w.features,
          ),
      );
    update();
    const a = registry.on("register", update),
      b = registry.on("unregister", update);
    return () => {
      a();
      b();
    };
  }, []);
  useEffect(() => {
    if (!selected) return;
    const f = selected.features["standard:events"] as Events | undefined;
    return f?.on("change", (p) => {
      if (p.accounts)
        updateAccount(
          p.accounts.find(
            (a) =>
              a.chains.some((c) => c.startsWith("solana:")) &&
              a.features.includes("solana:signTransaction"),
          ) ?? null,
        );
    });
  }, [selected, updateAccount]);
  async function connect(w: Wallet) {
    setBusy(true);
    setError("");
    try {
      const r = await (w.features["standard:connect"] as Connect).connect();
      const a = r.accounts.find(
        (a) =>
          a.chains.some((c) => c.startsWith("solana:")) &&
          a.features.includes("solana:signTransaction"),
      );
      if (!a)
        throw new Error(
          "This wallet has no Solana account with transaction signing enabled.",
        );
      setSelected(w);
      updateAccount(a);
      setShow(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection declined");
    } finally {
      setBusy(false);
    }
  }
  async function disconnect() {
    if (selected) {
      const f = selected.features["standard:disconnect"] as
        | { disconnect: () => Promise<void> }
        | undefined;
      await f?.disconnect();
    }
    updateAccount(null);
    setSelected(null);
  }
  async function sign(tx: Transaction, chain: string) {
    if (!selected || !account) throw new Error("Connect your wallet");
    if (!account.chains.includes(chain as `${string}:${string}`))
      throw new Error(`Choose the ${chain} network in your wallet.`);
    const address = account.address;
    const original = tx.serializeMessage();
    const r = await (
      selected.features["solana:signTransaction"] as Sign
    ).signTransaction({
      transaction: tx.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      }),
      account,
      chain,
    });
    if (current.current?.address !== address)
      throw new Error(
        "Wallet changed during signing. Review the transaction again.",
      );
    if (!r[0]) throw new Error("Wallet returned no signed transaction");
    const signed = Transaction.from(r[0].signedTransaction);
    if (
      !equal(original, signed.serializeMessage()) ||
      !signed.verifySignatures()
    )
      throw new Error("Wallet returned an altered or invalid transaction");
    return signed;
  }
  return (
    <WalletContext.Provider
      value={{
        ready,
        address,
        name: selected?.name ?? null,
        open: () => {
          setError("");
          setShow(true);
        },
        disconnect,
        sign,
      }}
    >
      {children}
      <Dialog open={show} onOpenChange={setShow}>
        <DialogContent>
          <DialogTitle>Connect your Solana wallet</DialogTitle>
          <DialogDescription>
            Connecting reads your public address. Moving assets requires an
            explicit transaction approval in your wallet.
          </DialogDescription>
          <div className="wallet-list">
            {wallets.map((w) => (
              <button
                className="wallet-option"
                key={w.name}
                disabled={busy}
                onClick={() => connect(w)}
              >
                <WalletIcon size={22} />
                <span>{w.name}</span>
                <span>Connect</span>
              </button>
            ))}
          </div>
          {wallets.length === 0 && (
            <div className="empty-state">
              <WalletIcon />
              <h3>No compatible wallet detected</h3>
              <p>
                Open Bunker in a browser with Phantom, Solflare, Backpack, or
                another Solana Wallet Standard wallet. Mobile users can use
                their wallet’s in-app browser.
              </p>
            </div>
          )}
          {error && (
            <div role="alert" className="error-box">
              {error}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </WalletContext.Provider>
  );
}
export function WalletButton() {
  const w = useWallet();
  return w.address ? (
    <button
      className="button compact ghost"
      onClick={() => void w.disconnect()}
      title="Disconnect wallet"
    >
      {w.address.toBase58().slice(0, 4)}…{w.address.toBase58().slice(-4)}
      <LogOut size={14} />
    </button>
  ) : (
    <button
      className="button compact light"
      disabled={!w.ready}
      onClick={w.open}
    >
      <WalletIcon size={15} />
      Connect wallet
    </button>
  );
}
