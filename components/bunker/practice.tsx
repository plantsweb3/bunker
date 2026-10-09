"use client";
// The practice run: get robbed on purpose, with pretend coins, and see what a
// Bunker changes. A picture game with almost no words. Nothing here touches a
// wallet or the network.
import { useEffect, useState } from "react";
import Link from "next/link";
import { Gift, Hand, RotateCcw } from "lucide-react";

const COINS = 10;
/** How long the pretend "day" lasts while the door waits. */
const WAIT_MS = 9000;
type Phase = "pack" | "bait" | "robbed" | "door" | "stopped" | "lost";
const TEXT = {
  en: {
    wallet: "WALLET",
    bunker: "BUNKER",
    thief: "THIEF",
    bait: "FREE COINS! CLAIM NOW",
    stop: "STOP",
    stopped: "STOPPED",
    day: "1 day",
    coin: (n: number, safe: boolean) =>
      safe ? `Coin ${n}, in the Bunker. Move it back to the wallet.` : `Coin ${n}, in the wallet. Move it into the Bunker.`,
    pack: ["Put your coins behind the door.", "Tap a coin to move it. Leave a little in your wallet for spending."],
    baitSay: ["A gift appears.", "Go on. Click it. This is only practice."],
    tookAll: "He took everything.",
    tookNone: "He found an empty wallet.",
    took: (n: number) => `He took your ${n}.`,
    keptSay: (n: number) => `The ${n} behind the door did not move. Your wallet cannot open that door.`,
    keptNone: "Nothing was behind the door.",
    door: ["Now he has your door key too.", "The door waits a day before it opens for a stranger. Press STOP."],
    stoppedSay: (n: number) => ["Stopped.", `Nothing left your Bunker. You kept ${n} of ${COINS}.`],
    lost: ["Too slow.", "In real life you get a whole day, and an alert on your phone. Try again."],
    ready: "I’m ready",
    skip: "Skip the Bunker and see what happens",
    move8: "Move 8 in for me",
    tallyWallet: "Wallet",
    tallyBunker: "Bunker",
    whatIf: "What if he gets my door key too?",
    retry: "Try again, with a Bunker",
    again: "Play again",
    check: "Check my real wallet",
    build: "Build my Bunker",
  },
};

/** Where things sit, in percent of the stage. */
const inWallet = (slot: number) => ({ left: 8.6 + (slot % 5) * 4.4, top: 59 + Math.floor(slot / 5) * 14 });
const inBunker = (slot: number) => ({ left: 43.2 + (slot % 4) * 5.3, top: 49 + Math.floor(slot / 4) * 13 });
const stolen = (slot: number) => ({ left: 73 + (slot % 5) * 4.6, top: 55 + Math.floor(slot / 5) * 12 });

export default function Practice() {
  const x = TEXT.en;
  const [phase, setPhase] = useState<Phase>("pack");
  /** Which coins the player has put behind the door. */
  const [safe, setSafe] = useState<boolean[]>(() => Array(COINS).fill(false));
  const kept = safe.filter(Boolean).length;
  const pocket = COINS - kept;

  // The thief has the door key. The door waits; the player has that long.
  useEffect(() => {
    if (phase !== "door") return;
    const t = setTimeout(() => setPhase("lost"), WAIT_MS);
    return () => clearTimeout(t);
  }, [phase]);

  const toggle = (i: number) => phase === "pack" && setSafe((s) => s.map((v, k) => (k === i ? !v : v)));
  const reset = () => {
    setSafe(Array(COINS).fill(false));
    setPhase("pack");
  };
  // Slots are assigned in coin order, so piles stay packed with no gaps.
  let w = 0;
  let b = 0;
  let t = 0;
  const places = safe.map((isSafe) => {
    const taken = isSafe ? phase === "lost" : ["robbed", "door", "stopped", "lost"].includes(phase);
    if (taken) return stolen(t++);
    return isSafe ? inBunker(b++) : inWallet(w++);
  });
  const thiefHere = phase !== "pack" && phase !== "bait";
  const atDoor = phase === "door" || phase === "stopped" || phase === "lost";

  const say: Record<Phase, string[]> = {
    pack: x.pack,
    bait: x.baitSay,
    robbed: [pocket === 0 ? x.tookNone : pocket === COINS ? x.tookAll : x.took(pocket), kept ? x.keptSay(kept) : x.keptNone],
    door: x.door,
    stopped: x.stoppedSay(kept),
    lost: x.lost,
  };
  return (
    <div className="practice" data-phase={phase}>
      <div className="practice-stage">
        <div className="practice-wallet">
          <i />
          <b>{x.wallet}</b>
        </div>
        <div className={`practice-bunker ${phase === "door" ? "knock" : ""}`}>
          <b>{x.bunker}</b>
        </div>
        {places.map((at, i) => (
          <button
            key={i}
            type="button"
            className={`practice-coin ${safe[i] && phase !== "lost" ? "safe" : ""}`}
            style={{ left: `${at.left}%`, top: `${at.top}%`, transitionDelay: phase === "robbed" || phase === "lost" ? `${i * 45}ms` : "0ms" }}
            onClick={() => toggle(i)}
            disabled={phase !== "pack"}
            aria-label={x.coin(i + 1, safe[i])}
          />
        ))}
        <div className={`practice-thief ${thiefHere ? "here" : ""} ${atDoor ? "at-door" : ""} ${phase === "stopped" ? "beaten" : ""}`} aria-hidden="true">
          <svg viewBox="0 0 64 64">
            <path d="M32 4c14 0 23 10 23 25v31H9V29C9 14 18 4 32 4z" fill="#2a1512" stroke="#f39687" strokeWidth="2.5" />
            <path d="M17 31c0-9 6-15 15-15s15 6 15 15c0 7-6 11-15 11s-15-4-15-11z" fill="#0a0a0a" stroke="#f39687" strokeWidth="2" />
            <path d="M22 30l8 2M42 30l-8 2" stroke="#f39687" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <span>{x.thief}</span>
        </div>
        {phase === "bait" && (
          <button type="button" className="practice-bait" onClick={() => setPhase("robbed")}>
            <Gift size={22} />
            {x.bait}
          </button>
        )}
        {phase === "door" && (
          <>
            <div className="practice-clock" aria-hidden="true">
              <svg viewBox="0 0 44 44">
                <circle cx="22" cy="22" r="18" />
                <circle cx="22" cy="22" r="18" className="run" style={{ animationDuration: `${WAIT_MS}ms` }} />
              </svg>
              <span>{x.day}</span>
            </div>
            <button type="button" className="practice-stop" onClick={() => setPhase("stopped")}>
              <Hand size={26} />
              {x.stop}
            </button>
          </>
        )}
        {phase === "stopped" && <span className="practice-stamp">{x.stopped}</span>}
      </div>
      <div className="practice-words" aria-live="polite">
        <h2>{say[phase][0]}</h2>
        <p>{say[phase][1]}</p>
        <div className="practice-actions">
          {phase === "pack" && (
            <>
              <button type="button" className="button light" onClick={() => setPhase("bait")}>
                {kept ? x.ready : x.skip}
              </button>
              {kept < 8 && (
                <button type="button" className="button ghost" onClick={() => setSafe(safe.map((_, i) => i < 8))}>
                  {x.move8}
                </button>
              )}
              <span className="practice-tally">
                {x.tallyWallet} <b>{pocket}</b> · {x.tallyBunker} <b className="ice">{kept}</b>
              </span>
            </>
          )}
          {phase === "robbed" &&
            (kept ? (
              <button type="button" className="button light" onClick={() => setPhase("door")}>
                {x.whatIf}
              </button>
            ) : (
              <button type="button" className="button light" onClick={reset}>
                <RotateCcw size={15} />
                {x.retry}
              </button>
            ))}
          {(phase === "stopped" || phase === "lost") && (
            <>
              <button type="button" className="button ghost" onClick={reset}>
                <RotateCcw size={15} />
                {x.again}
              </button>
              {phase === "stopped" && (
                <>
                  <Link className="button light" href="/check">
                    {x.check}
                  </Link>
                  <Link className="button ghost" href="/recovery">
                    {x.build}
                  </Link>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
