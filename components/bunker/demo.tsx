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
  "Compromise wallet",
  "Test the boundary",
  "Authorize a withdrawal",
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
            A wallet compromise.
            <br />
            <span className="ice">A different outcome.</span>
          </h1>
          <p>Explore why a vault needs independent authorization.</p>
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
              {stage === "withdrawn" ? "$10,000" : moved ? "$0" : "$250,000"}
            </strong>
            <div className="sim-assets">
              <span className="asset-logo">≋</span>
              <span>SOL + classic SPL tokens</span>
            </div>
            <div className="account-status">
              {attacked ? (
                <>
                  <X size={15} />
                  Wallet signing key compromised
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
              {stage === "withdrawn" ? "$240,000" : moved ? "$250,000" : "$0"}
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
                  ? "THREAT DETECTED"
                  : stage === "rejected"
                    ? "WITHDRAWAL REJECTED"
                    : "WITHDRAWAL COMPLETE"}
          </span>
          <h2>
            {stage === "wallet"
              ? "Give your assets a separate boundary."
              : stage === "bunkered"
                ? "Now put the everyday wallet to the test."
                : stage === "compromised"
                  ? "The attacker has one key. Is it enough?"
                  : stage === "rejected"
                    ? "The vault requires independent approval."
                    : "Authorization determines who can spend."}
          </h2>
          <p>
            {stage === "wallet"
              ? "Move the example portfolio into a vault controlled by an independent authorization policy."
              : stage === "bunkered"
                ? "We will simulate theft of the connected wallet key. This is an educational model, not a cryptographic proof."
                : stage === "compromised"
                  ? "Attempt a withdrawal using only the compromised everyday wallet."
                  : stage === "rejected"
                    ? "The simulated withdrawal is blocked because the independent authorization is missing. Now supply that authorization."
                    : "The authorized transfer completes and the simulated one-time authority rotates. The test implementation performs that change atomically on-chain."}
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
                Simulate wallet compromise
              </button>
            ) : stage === "compromised" ? (
              <button
                disabled={!ready}
                className="button danger"
                onClick={() => action("attack")}
              >
                Attempt unauthorized withdrawal
              </button>
            ) : stage === "rejected" ? (
              <button
                disabled={!ready}
                className="button light"
                onClick={() => action("withdraw")}
              >
                Authorize $10,000 withdrawal
              </button>
            ) : (
              <Link href="/vault" className="button light">
                Explore the live app
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
