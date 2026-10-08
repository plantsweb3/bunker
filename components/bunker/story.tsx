"use client";
// The landing page's explainer: the same person, with and without a Bunker,
// through one bad click. Pictures first; one short line of words per beat.
// Illustration only. Nothing here touches a wallet or the network.
import { useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";

type Beat = { title: string; without: string; with: string };
const BEATS: Beat[] = [
  {
    title: "This is everything you own.",
    without: "All of it sits in your wallet.",
    with: "A little stays in your wallet. The rest goes in your Bunker.",
  },
  {
    title: "One day, you click the wrong thing.",
    without: "It looked like a free airdrop.",
    with: "Same click. Same mistake.",
  },
  {
    title: "The thief takes whatever your wallet can reach.",
    without: "That was everything.",
    with: "That was your pocket money.",
  },
  {
    title: "Then the thief tries your Bunker.",
    without: "Nothing left to try.",
    with: "Your wallet’s key does not open this door.",
  },
  {
    title: "Even with a stolen Bunker key, the door waits a day.",
    without: "Still nothing.",
    with: "You get an alert. You press cancel. Nothing leaves.",
  },
  {
    title: "Same click. Different day.",
    without: "Lost: everything.",
    with: "Lost: pocket money. Kept: the rest.",
  },
];
const LAST = BEATS.length - 1;
const HOLD_MS = 3600;

/** Where each coin rests, in percent of its lane. */
const walletHome = (i: number) => ({ left: 10.5 + (i % 5) * 5.4, top: 62 + Math.floor(i / 5) * 11.5 });
const pocketHome = (i: number) => ({ left: 9.5 + i * 6.2, top: 71 });
const bunkerHome = (i: number) => ({ left: 42.2 + (i % 4) * 5.9, top: 62 + Math.floor(i / 4) * 11.5 });
const loot = (i: number) => ({ left: 66 + (i % 5) * 5, top: 44 + Math.floor(i / 5) * 9 });
/** In the second lane the thief walks to the door, so its takings sit clear of it. */
const pocketLoot = (i: number) => ({ left: 88 + i * 5.4, top: 46 });

function Coin({ at, delay = 0, safe = false }: { at: { left: number; top: number }; delay?: number; safe?: boolean }) {
  return (
    <span
      className={`story-coin ${safe ? "safe" : ""}`}
      style={{ left: `${at.left}%`, top: `${at.top}%`, transitionDelay: `${delay}ms` }}
    />
  );
}
function Thief() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <path d="M32 4c14 0 23 10 23 25v31H9V29C9 14 18 4 32 4z" fill="#2a1512" stroke="#f39687" strokeWidth="2.5" />
      <path d="M17 31c0-9 6-15 15-15s15 6 15 15c0 7-6 11-15 11s-15-4-15-11z" fill="#0a0a0a" stroke="#f39687" strokeWidth="2" />
      <path d="M22 30l8 2M42 30l-8 2" stroke="#f39687" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export default function Story() {
  const [beat, setBeat] = useState(0);
  const [playing, setPlaying] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  // Starts by itself the first time it scrolls into view, unless the visitor
  // has asked for less motion; then it waits to be stepped through.
  useEffect(() => {
    const el = stage.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const seen = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started.current) {
          started.current = true;
          setPlaying(true);
        }
        if (!entry.isIntersecting) setPlaying(false);
      },
      { threshold: 0.45 },
    );
    seen.observe(el);
    return () => seen.disconnect();
  }, []);
  // Playing means advancing; at the last beat there is nothing left to play.
  const running = playing && beat < LAST;
  useEffect(() => {
    if (!running) return;
    const t = setTimeout(() => setBeat((b) => Math.min(b + 1, LAST)), HOLD_MS);
    return () => clearTimeout(t);
  }, [running, beat]);

  const go = (b: number) => {
    setPlaying(false);
    setBeat(b);
  };
  const taken = beat >= 2;
  const b = BEATS[beat];
  return (
    <div className="story" data-beat={beat} ref={stage}>
      <div className="story-lanes" aria-hidden="true">
        {/* Without a Bunker */}
        <div className="story-lane without">
          <span className="story-tag">WITHOUT A BUNKER</span>
          <div className="story-wallet">
            <i />
            <b>WALLET</b>
          </div>
          {Array.from({ length: 10 }, (_, i) => (
            <Coin key={i} at={taken ? loot(i) : walletHome(i)} delay={taken ? i * 60 : 0} />
          ))}
          <div className="story-thief">
            <Thief />
          </div>
          <div className="story-hook" />
          <span className="story-signed">SIGNED</span>
          <span className="story-count">{taken ? "0" : "10"}</span>
        </div>
        {/* With a Bunker */}
        <div className="story-lane with">
          <span className="story-tag ice">WITH A BUNKER</span>
          <div className="story-wallet small">
            <i />
            <b>WALLET</b>
          </div>
          {[0, 1].map((i) => (
            <Coin key={`p${i}`} at={taken ? pocketLoot(i) : pocketHome(i)} delay={taken ? i * 60 : 0} />
          ))}
          <div className="story-bunker">
            <b>BUNKER</b>
          </div>
          {Array.from({ length: 8 }, (_, i) => (
            <Coin key={`b${i}`} at={bunkerHome(i)} safe />
          ))}
          <div className="story-thief">
            <Thief />
          </div>
          <div className="story-hook" />
          <span className="story-signed">SIGNED</span>
          <span className="story-denied">WRONG KEY</span>
          <div className="story-timer">
            <svg viewBox="0 0 44 44">
              <circle cx="22" cy="22" r="18" />
              <circle cx="22" cy="22" r="18" className="run" />
            </svg>
            <span>24h</span>
          </div>
          <span className="story-cancelled">CANCELLED</span>
          <span className="story-count">8</span>
        </div>
      </div>

      {/* The words, for everyone, and the whole story for a screen reader. */}
      <div className="story-words" aria-live="polite">
        <h3>{b.title}</h3>
        <div>
          <p>
            <span>Without a Bunker</span>
            {b.without}
          </p>
          <p className="ice">
            <span>With a Bunker</span>
            {b.with}
          </p>
        </div>
      </div>
      <div className="story-controls">
        <button
          className="story-play"
          onClick={() => {
            if (beat === LAST) setBeat(0);
            setPlaying(beat === LAST ? true : !playing);
            started.current = true;
          }}
          aria-label={beat === LAST ? "Play again" : running ? "Pause" : "Play"}
        >
          {beat === LAST ? <RotateCcw size={15} /> : running ? <Pause size={15} /> : <Play size={15} />}
          {beat === LAST ? "Again" : running ? "Pause" : "Play"}
        </button>
        <div className="story-dots" role="tablist" aria-label="Steps of the story">
          {BEATS.map((x, i) => (
            <button
              key={x.title}
              role="tab"
              aria-selected={i === beat}
              aria-label={`Step ${i + 1} of ${BEATS.length}: ${x.title}`}
              className={i === beat ? "on" : i < beat ? "done" : ""}
              onClick={() => go(i)}
            />
          ))}
        </div>
        <span className="story-note">An illustration. Not a guarantee.</span>
      </div>
    </div>
  );
}
