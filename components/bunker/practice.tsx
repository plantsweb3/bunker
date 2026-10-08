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

/** Where things sit, in percent of the stage. */
const inWallet = (slot: number) => ({ left: 8.6 + (slot % 5) * 4.4, top: 59 + Math.floor(slot / 5) * 14 });
const inBunker = (slot: number) => ({ left: 43.2 + (slot % 4) * 5.3, top: 49 + Math.floor(slot / 4) * 13 });
const stolen = (slot: number) => ({ left: 73 + (slot % 5) * 4.6, top: 55 + Math.floor(slot / 5) * 12 });

export default function Practice() {
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

  const say: Record<Phase, [string, string]> = {
    pack: ["Put your coins behind the door.", "Tap a coin to move it. Leave a little in your wallet for spending."],
    bait: ["A gift appears.", "Go on. Click it. This is only practice."],
    robbed: [
      pocket === 0 ? "He found an empty wallet." : `He took ${pocket === COINS ? "everything" : `your ${pocket}`}.`,
      kept ? `The ${kept} behind the door did not move. Your wallet cannot open that door.` : "Nothing was behind the door.",
    ],
    door: ["Now he has your door key too.", "The door waits a day before it opens for a stranger. Press STOP."],
    stopped: ["Stopped.", `Nothing left your Bunker. You kept ${kept} of ${COINS}.`],
    lost: ["Too slow.", "In real life you get a whole day, and an alert on your phone. Try again."],
  };
  return (
    <div className="practice" data-phase={phase}>
      <div className="practice-stage">
        <div className="story-wallet practice-wallet">
          <i />
          <b>WALLET</b>
        </div>
        <div className={`story-bunker practice-bunker ${phase === "door" ? "knock" : ""}`}>
          <b>BUNKER</b>
        </div>
        {places.map((at, i) => (
          <button
            key={i}
            type="button"
            className={`story-coin practice-coin ${safe[i] && phase !== "lost" ? "safe" : ""}`}
            style={{ left: `${at.left}%`, top: `${at.top}%`, transitionDelay: phase === "robbed" || phase === "lost" ? `${i * 45}ms` : "0ms" }}
            onClick={() => toggle(i)}
            disabled={phase !== "pack"}
            aria-label={safe[i] ? `Coin ${i + 1}, in the Bunker. Move it back to the wallet.` : `Coin ${i + 1}, in the wallet. Move it into the Bunker.`}
          />
        ))}
        <div className={`practice-thief ${thiefHere ? "here" : ""} ${atDoor ? "at-door" : ""} ${phase === "stopped" ? "beaten" : ""}`} aria-hidden="true">
          <svg viewBox="0 0 64 64">
            <path d="M32 4c14 0 23 10 23 25v31H9V29C9 14 18 4 32 4z" fill="#2a1512" stroke="#f39687" strokeWidth="2.5" />
            <path d="M17 31c0-9 6-15 15-15s15 6 15 15c0 7-6 11-15 11s-15-4-15-11z" fill="#0a0a0a" stroke="#f39687" strokeWidth="2" />
            <path d="M22 30l8 2M42 30l-8 2" stroke="#f39687" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <span>THIEF</span>
        </div>
        {phase === "bait" && (
          <button type="button" className="practice-bait" onClick={() => setPhase("robbed")}>
            <Gift size={22} />
            FREE COINS! CLAIM NOW
          </button>
        )}
        {phase === "door" && (
          <>
            <div className="practice-clock" aria-hidden="true">
              <svg viewBox="0 0 44 44">
                <circle cx="22" cy="22" r="18" />
                <circle cx="22" cy="22" r="18" className="run" style={{ animationDuration: `${WAIT_MS}ms` }} />
              </svg>
              <span>1 day</span>
            </div>
            <button type="button" className="practice-stop" onClick={() => setPhase("stopped")}>
              <Hand size={26} />
              STOP
            </button>
          </>
        )}
        {phase === "stopped" && <span className="story-cancelled practice-stamp">STOPPED</span>}
      </div>
      <div className="practice-words" aria-live="polite">
        <h2>{say[phase][0]}</h2>
        <p>{say[phase][1]}</p>
        <div className="practice-actions">
          {phase === "pack" && (
            <>
              <button type="button" className="button light" onClick={() => setPhase("bait")}>
                {kept ? "I’m ready" : "Skip the Bunker and see what happens"}
              </button>
              {kept < 8 && (
                <button type="button" className="button ghost" onClick={() => setSafe(safe.map((_, i) => i < 8))}>
                  Move 8 in for me
                </button>
              )}
              <span className="practice-tally">
                Wallet <b>{pocket}</b> · Bunker <b className="ice">{kept}</b>
              </span>
            </>
          )}
          {phase === "robbed" &&
            (kept ? (
              <button type="button" className="button light" onClick={() => setPhase("door")}>
                What if he gets my door key too?
              </button>
            ) : (
              <button type="button" className="button light" onClick={reset}>
                <RotateCcw size={15} />
                Try again, with a Bunker
              </button>
            ))}
          {(phase === "stopped" || phase === "lost") && (
            <>
              <button type="button" className="button ghost" onClick={reset}>
                <RotateCcw size={15} />
                Play again
              </button>
              {phase === "stopped" && (
                <>
                  <Link className="button light" href="/check">
                    Check my real wallet
                  </Link>
                  <Link className="button ghost" href="/recovery">
                    Build my Bunker
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
