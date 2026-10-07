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
} from "lucide-react";
import { transition, DemoStage, DemoAction } from "@/sdk/demo";
const steps = [
  "Move assets",
  "Sign the fake airdrop",
  "The drainer tries the vault",
  "Withdraw with your key",
];
export default function Demo() {
  const [stage, setStage] = useState<DemoStage>("wallet");
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
  const action = (a: DemoAction) => {
    stateRef.current = transition(stateRef.current, a);
    setStage(stateRef.current);
  };
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
              stateRef.current = transition(
                stateRef.current,
                input.action as DemoAction,
              );
              setStage(stateRef.current);
              return { stage: stateRef.current, simulated: true };
            },
          },
          { signal: lifecycle.signal },
        ),
      ).catch(() => {});
    } catch {}
    return () => lifecycle.abort();
  }, []);
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
          <p>Four clicks: what a drainer takes, and what it can’t reach.</p>
        </div>
        <span className="pill">
          <FlaskConical size={14} />
          SIMULATION · NO REAL ASSETS
        </span>
      </div>
      <div className="simulation">
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
            <strong className="sim-balance">
              {attacked ? "$0" : moved ? "$200" : "$4,200"}
            </strong>
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
            <strong className="sim-balance">
              {stage === "withdrawn" ? "$3,500" : moved ? "$4,000" : "$0"}
            </strong>
            <div className="sim-assets">
              <Fingerprint size={19} />
              <span>Independent authorization required</span>
            </div>
            <div className="account-status">
              {moved ? (
                <>
                  <LockKeyhole size={15} />
                  Separate authority active
                </>
              ) : (
                <>Ready for a simulated deposit</>
              )}
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
        Illustrative balances only. This demo does not establish security
        against quantum attacks, compromised devices, malicious programs, or
        compromised independent signers.{" "}
        <Link href="/security">Read the actual threat model.</Link>
      </p>
    </div>
  );
}
