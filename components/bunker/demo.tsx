"use client";
import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useHydrated } from "./use-hydrated";
import {
  Shield,
  Wallet,
  RotateCcw,
  Check,
  X,
  LockKeyhole,
  Fingerprint,
  FlaskConical,
  Globe,
  ArrowRight,
} from "lucide-react";
import { transition, DemoStage, DemoAction } from "@/sdk/demo";
import { generateKey, signOnce, verify } from "@/sdk/winternitz";
import { hex } from "@/sdk/bytes";
const steps = [
  "Move assets",
  "Sign the fake airdrop",
  "The drainer tries the vault",
  "Withdraw with your key",
];
type Line = { tag: string; text: string; tone?: "ok" | "bad" };
type Keys = {
  secret: Uint8Array;
  root: Uint8Array;
  spent?: Uint8Array;
  signature?: Uint8Array;
  message?: Uint8Array;
};
const short = (b: Uint8Array) => `${hex(b).slice(0, 8)}…${hex(b).slice(-6)}`;
const encode = (s: string) => new TextEncoder().encode(s);
const timed = <T,>(fn: () => T): [T, string] => {
  const t = performance.now();
  const v = fn();
  return [v, `${Math.max(1, Math.round(performance.now() - t))} ms`];
};
// Demo-only message. Real withdrawals sign the fixed layout in sdk/protocol.ts.
const demoMessage = (root: Uint8Array, next: Uint8Array) =>
  encode(
    `BUNKER_DEMO_ONLY|withdraw|500|to:new-wallet|lock:${hex(root)}|next:${hex(next)}`,
  );
/** Runs the real one-time signature code for each step. Nothing leaves the tab. */
function run(action: DemoAction, keys: { current: Keys | null }): Line[] {
  if (action === "reset") {
    keys.current?.secret.fill(0);
    keys.current = null;
    return [];
  }
  if (action === "deposit") {
    const [k, ms] = timed(generateKey);
    keys.current = k;
    return [
      { tag: "keygen", text: "1,088 random bytes → 34 hash chains × 255" },
      {
        tag: "lock",
        text: `${short(k.root)} · 8,670 SHA-256 in ${ms}`,
        tone: "ok",
      },
      { tag: "deposit", text: "$4,000 → vault. Deposits need only the wallet." },
    ];
  }
  const k = keys.current;
  if (!k) return [];
  if (action === "compromise")
    return [
      { tag: "wallet", text: "approved “Claim 2.5 SOL”" },
      {
        tag: "drainer",
        text: "transfer $200 → attacker · wallet signature valid",
        tone: "bad",
      },
    ];
  if (action === "attack") {
    const forged = crypto.getRandomValues(new Uint8Array(1088));
    const message = encode(
      `BUNKER_DEMO_ONLY|withdraw|4000|to:attacker|lock:${hex(k.root)}`,
    );
    const [valid, ms] = timed(() => verify(forged, message, k.root));
    return [
      { tag: "drainer", text: "withdraw $4,000 → attacker, signed by wallet" },
      { tag: "verify", text: `1,088-byte authorization vs lock ${short(k.root)}` },
      {
        tag: "verify",
        text: `→ ${valid} in ${ms}. The drainer has no Bunker key to sign with.`,
        tone: valid ? "bad" : "ok",
      },
    ];
  }
  const next = generateKey();
  const message = demoMessage(k.root, next.root);
  const signature = signOnce(k.secret, message);
  const [valid, ms] = timed(() => verify(signature, message, k.root));
  const replay = verify(signature, message, next.root);
  keys.current = { ...next, spent: k.root, signature, message };
  return [
    { tag: "sign", text: `one-time key signs: $500 → new wallet, next lock ${short(next.root)}` },
    { tag: "verify", text: `→ ${valid} in ${ms}`, tone: valid ? "ok" : "bad" },
    { tag: "rotate", text: `lock ${short(k.root)} → ${short(next.root)}`, tone: "ok" },
    {
      tag: "replay",
      text: `same signature vs new lock → ${replay}`,
      tone: replay ? "bad" : "ok",
    },
  ];
}
function useTween(target: number) {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = from.current;
    if (
      start === target ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      from.current = target;
      setValue(target);
      return;
    }
    let frame = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / 900);
      const v = Math.round(start + (target - start) * (1 - (1 - p) ** 3));
      from.current = v;
      setValue(v);
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return `$${value.toLocaleString("en-US")}`;
}
export default function Demo() {
  const [stage, setStage] = useState<DemoStage>("wallet");
  const [log, setLog] = useState<Line[]>([]);
  const [lock, setLock] = useState<{ root: string; spent?: string } | null>(
    null,
  );
  const ready = useHydrated();
  const active =
    stage === "wallet"
      ? 0
      : stage === "bunkered"
        ? 1
        : stage === "compromised"
          ? 2
          : 3;
  const moved = stage !== "wallet",
    attacked = ["compromised", "rejected", "withdrawn"].includes(stage);
  const stateRef = useRef<DemoStage>("wallet");
  const keys = useRef<Keys | null>(null);
  const logEnd = useRef<HTMLDivElement>(null);
  const action = (a: DemoAction) => {
    stateRef.current = transition(stateRef.current, a);
    const lines = run(a, keys);
    setLog((old) => (a === "reset" ? [] : [...old, ...lines]));
    setLock(
      keys.current
        ? {
            root: short(keys.current.root),
            spent: keys.current.spent && short(keys.current.spent),
          }
        : null,
    );
    setStage(stateRef.current);
    return stateRef.current;
  };
  const actionRef = useRef(action);
  useEffect(() => {
    actionRef.current = action;
  });
  useEffect(() => {
    const box = logEnd.current?.parentElement;
    if (box) box.scrollTop = box.scrollHeight;
  }, [log]);
  useEffect(() => {
    const doc = document as Document & {
      modelContext?: {
        registerTool: (
          tool: unknown,
          options: { signal: AbortSignal },
        ) => unknown;
      };
    };
    if (!doc.modelContext) return;
    const lifecycle = new AbortController();
    try {
      Promise.resolve(
        doc.modelContext.registerTool(
          {
            name: "advance_bunker_simulation",
            description:
              "Advance the educational simulation. Never connects a wallet or moves real assets.",
            inputSchema: {
              type: "object",
              properties: {
                action: {
                  type: "string",
                  enum: [
                    "deposit",
                    "compromise",
                    "attack",
                    "withdraw",
                    "reset",
                  ],
                },
              },
              required: ["action"],
              additionalProperties: false,
            },
            annotations: { readOnlyHint: false },
            execute(input: unknown) {
              if (
                !input ||
                typeof input !== "object" ||
                Object.keys(input).length !== 1 ||
                !("action" in input) ||
                ![
                  "deposit",
                  "compromise",
                  "attack",
                  "withdraw",
                  "reset",
                ].includes(String(input.action))
              )
                throw new Error("Invalid simulation action");
              return {
                stage: actionRef.current(input.action as DemoAction),
                simulated: true,
              };
            },
          },
          { signal: lifecycle.signal },
        ),
      ).catch(() => {});
    } catch {}
    return () => lifecycle.abort();
  }, []);
  const walletBalance = useTween(attacked ? 0 : moved ? 200 : 4200);
  const vaultBalance = useTween(
    stage === "withdrawn" ? 3500 : moved ? 4000 : 0,
  );
  return (
    <div className="demo-wrap">
      <div className="page-heading">
        <div>
          <div className="eyebrow">EXPERIENCE THE BOUNDARY</div>
          <h1>
            A drained wallet.
            <br />
            <span className="ice">A different outcome.</span>
          </h1>
          <p>
            Four clicks. The signature checks are real and run in this tab; the
            balances and the drainer are simulated.
          </p>
        </div>
        <span className="pill">
          <FlaskConical size={14} />
          SIMULATION · NO REAL ASSETS
        </span>
      </div>
      <div className={`simulation stage-${stage}`}>
        <div className="sim-progress">
          {steps.map((s, i) => (
            <div key={s} className={i <= active ? "current" : ""}>
              <span>{String(i + 1).padStart(2, "0")}</span>
              {s}
            </div>
          ))}
        </div>
        <div className="sim-accounts">
          <div className={`sim-account ${attacked ? "compromised" : ""}`}>
            <div className="sim-account-head">
              <Wallet />
              <span>EVERYDAY WALLET</span>
            </div>
            <span className="balance-label">Simulated portfolio</span>
            <strong className="sim-balance">{walletBalance}</strong>
            <div className="sim-assets">
              <span className="asset-logo">≋</span>
              <span>SOL + classic SPL tokens</span>
            </div>
            <div className="account-status">
              {attacked ? (
                <>
                  <X size={15} />
                  Drained · signing key compromised
                </>
              ) : (
                <>
                  <Check size={15} />
                  Wallet signing key active
                </>
              )}
            </div>
          </div>
          <div className={`sim-connector ${moved ? "active" : ""}`}>
            <span />
            <Shield />
            <span />
          </div>
          <div className={`sim-account ${moved ? "protected" : ""}`}>
            <div className="sim-account-head">
              <Shield />
              <span>YOUR BUNKER</span>
            </div>
            <span className="balance-label">Simulated vault balance</span>
            <strong className="sim-balance">{vaultBalance}</strong>
            <div className="sim-assets">
              <Fingerprint size={19} />
              {lock ? (
                <span className="sim-lock" key={lock.root}>
                  Lock <code>{lock.root}</code>
                </span>
              ) : (
                <span>Independent authorization required</span>
              )}
            </div>
            <div className="account-status">
              {moved ? (
                <>
                  <LockKeyhole size={15} />
                  {lock?.spent
                    ? "Lock replaced after withdrawal"
                    : "Separate authority active"}
                </>
              ) : (
                <>Ready for a simulated deposit</>
              )}
            </div>
          </div>
        </div>
        <div className="sim-scene">
          <div className="sim-stagecard" key={stage}>
            {stage === "wallet" ? (
              <>
                <span className="mono">BEFORE</span>
                <h3>Everything sits behind one key.</h3>
                <p>
                  Whoever gets a signature from this wallet can move all
                  $4,200. Step one puts most of it behind a second key
                  generated in this tab.
                </p>
              </>
            ) : stage === "bunkered" ? (
              <div className="fake-site" aria-label="Simulated phishing page">
                <div className="fake-bar">
                  <Globe size={13} />
                  <span>sol-rewards-claim.example</span>
                  <em>SIMULATED</em>
                </div>
                <div className="fake-body">
                  <strong>You’re eligible for 2.5 SOL</strong>
                  <span>Connect and approve to claim before it expires.</span>
                  <div className="fake-sheet">
                    <span>Approve transaction</span>
                    <b>Claim 2.5 SOL</b>
                  </div>
                </div>
              </div>
            ) : stage === "compromised" ? (
              <>
                <span className="mono">WHAT YOU ACTUALLY APPROVED</span>
                <ul className="approved-list">
                  <li>
                    <s>Claim 2.5 SOL</s>
                  </li>
                  <li>
                    Transfer all SOL <ArrowRight size={13} /> attacker
                  </li>
                  <li>
                    Transfer all tokens <ArrowRight size={13} /> attacker
                  </li>
                </ul>
                <p>
                  The wallet’s signature was valid, so the network did what it
                  was told.
                </p>
              </>
            ) : stage === "rejected" ? (
              <>
                <span className="mono">VAULT RESPONSE</span>
                <div className="verdict bad">
                  <X size={20} />
                  Authorization invalid
                </div>
                <p>
                  The vault checks a one-time hash signature against its lock.
                  A wallet signature is the wrong kind of key, and guessing the
                  right one means reversing SHA-256.
                </p>
              </>
            ) : (
              <>
                <span className="mono">LOCK CHANGED</span>
                <div className="lock-change">
                  <code>
                    <s>{lock?.spent}</s>
                  </code>
                  <ArrowRight size={15} />
                  <code className="ice">{lock?.root}</code>
                </div>
                <p>
                  The key you just used is spent. The withdrawal and the new
                  lock were set together, so the same signature can’t be used
                  twice.
                </p>
              </>
            )}
          </div>
          <div className="sim-log" aria-label="Verification log">
            <div className="sim-log-head">
              <span className="mono">VERIFICATION LOG</span>
              <span className="mono">sdk/winternitz.ts · runs locally</span>
            </div>
            <div className="sim-log-body">
              {log.length ? (
                log.map((l, i) => (
                  <div key={i} className={`log-line ${l.tone ?? ""}`}>
                    <span>{l.tag}</span>
                    <span>{l.text}</span>
                  </div>
                ))
              ) : (
                <div className="log-line idle">
                  <span>idle</span>
                  <span>waiting for step one</span>
                </div>
              )}
              <div ref={logEnd} />
            </div>
          </div>
        </div>
        <div className="sim-console" aria-live="polite">
          <span className="mono">
            {stage === "wallet"
              ? "READY"
              : stage === "bunkered"
                ? "DEPOSIT COMPLETE"
                : stage === "compromised"
                  ? "WALLET DRAINED"
                  : stage === "rejected"
                    ? "WITHDRAWAL REJECTED"
                    : "WITHDRAWAL COMPLETE"}
          </span>
          <h2>
            {stage === "wallet"
              ? "Put what you can’t lose behind a second key."
              : stage === "bunkered"
                ? "Now make the mistake everyone makes once."
                : stage === "compromised"
                  ? "The drainer took the wallet. Next it tries the vault."
                  : stage === "rejected"
                    ? "Rejected. A wallet signature is not the Bunker key."
                    : "You got out. The drainer never got in."}
          </h2>
          <p>
            {stage === "wallet"
              ? "Move $4,000 of the example balance into a vault. Leave $200 in the wallet for everyday use."
              : stage === "bunkered"
                ? "A page promises a free airdrop and asks your wallet to approve a transaction. You approve it. This is an educational model, not a cryptographic proof."
                : stage === "compromised"
                  ? "The $200 left in the wallet is gone. The drainer now signs a withdrawal from your Bunker using the wallet it controls."
                  : stage === "rejected"
                    ? "The vault only releases assets to the separate key in your recovery kit, which the drainer never saw. Now use that key yourself."
                    : "$500 went to a new, clean wallet and the vault’s key was replaced in the same step. Your part: keep the recovery kit off the device you browse with. If the drainer had that too, this would have ended differently."}
          </p>
          <div className="sim-controls">
            {stage === "wallet" ? (
              <button
                disabled={!ready}
                className="button light"
                onClick={() => action("deposit")}
              >
                Move assets into Bunker
              </button>
            ) : stage === "bunkered" ? (
              <button
                disabled={!ready}
                className="button danger"
                onClick={() => action("compromise")}
              >
                Approve the fake airdrop
              </button>
            ) : stage === "compromised" ? (
              <button
                disabled={!ready}
                className="button danger"
                onClick={() => action("attack")}
              >
                Let the drainer try the vault
              </button>
            ) : stage === "rejected" ? (
              <button
                disabled={!ready}
                className="button light"
                onClick={() => action("withdraw")}
              >
                Withdraw $500 with your Bunker key
              </button>
            ) : (
              <Link href="/vault" className="button light">
                Preview the app
              </Link>
            )}
            <button className="text-button" onClick={() => action("reset")}>
              <RotateCcw size={14} />
              Reset simulation
            </button>
          </div>
        </div>
      </div>
      <p className="demo-disclaimer">
        Illustrative balances only. The log runs Bunker’s browser signature
        code on a demo message; it is not the on-chain program and not a
        security proof. This demo does not establish security against quantum
        attacks, compromised devices, malicious programs, or compromised
        independent signers.{" "}
        <Link href="/security">Read the actual threat model.</Link>
      </p>
    </div>
  );
}
