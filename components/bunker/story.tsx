"use client";
// The landing page's explainer: the same person, with and without a Bunker,
// through one bad click. Pictures first; one short line of words per beat.
// Illustration only. Nothing here touches a wallet or the network.
//
// Each side is one drawing, 400 by 300. Where things rest at each beat is plain
// CSS state keyed on data-beat; the movement on the way there is decoration, so
// a visitor who asked for less motion sees the same pictures, standing still.
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";

type Beat = { title: string; without: string; with: string };
const TEXT = {
  en: {
    without: "Without a Bunker",
    with: "With a Bunker",
    wallet: "WALLET",
    bunker: "BUNKER",
    thief: "THIEF",
    free: "FREE",
    badClick: "BAD CLICK",
    stop: "CANCEL",
    wrongKey: "WRONG KEY",
    cancelled: "CANCELLED",
    play: "Play",
    pause: "Pause",
    again: "Again",
    playAgain: "Play again",
    steps: "Steps of the story",
    step: (n: number, of: number, title: string) => `Step ${n} of ${of}: ${title}`,
    note: "An illustration. Not a guarantee.",
    beats: [
      { title: "This is everything you own.", without: "All of it sits in your wallet.", with: "A little stays in your wallet. The rest goes in your Bunker." },
      { title: "One day, you click the wrong thing.", without: "It looked like a free airdrop.", with: "Same click. Same mistake." },
      { title: "The thief takes whatever your wallet can reach.", without: "That was everything.", with: "That was your pocket money." },
      { title: "Then the thief tries your Bunker.", without: "Nothing left to try.", with: "Your wallet’s key does not open this door." },
      { title: "Even with a stolen Bunker key, the door waits a day.", without: "Still nothing.", with: "You get an alert. You press cancel. Nothing leaves." },
      { title: "Same click. Different day.", without: "Lost: everything.", with: "Lost: pocket money. Kept: the rest." },
    ] as Beat[],
  },
};
const BEATS = TEXT.en.beats;
const LAST = BEATS.length - 1;
/** How long each beat is held before the next, long enough for its movement to finish. */
const HOLD_MS = [4800, 4400, 3600, 4000, 5400];

type Point = { x: number; y: number };
const grid = (x0: number, y0: number, columns: number, dx: number, dy: number) => (i: number): Point => ({
  x: x0 + (i % columns) * dx,
  y: y0 + Math.floor(i / columns) * dy,
});
/** Where each coin rests, in the drawing's own units. */
const walletHome = grid(46, 198, 5, 20, 26);
const purseHome = grid(36, 222, 5, 13, 18);
const pocketHome = (i: number): Point => ({ x: 50 + i * 24, y: 231 });
const bunkerHome = grid(166, 210, 4, 24, 28);
/** The thief's takings: a heap of ten on one side, two loose coins on the other. */
const HEAP: Point[] = [4, 3, 2, 1].flatMap((n, row) =>
  Array.from({ length: n }, (_, i) => ({ x: 330 - (n - 1) * 10 + i * 20, y: 184 - row * 17 })),
);
const pocketLoot = (i: number): Point => ({ x: 366 + i * 19, y: 100 });

function Coin({ at, from, delay = 0, safe = false }: { at: Point; from?: Point; delay?: number; safe?: boolean }) {
  const style = {
    "--x": `${at.x}px`,
    "--y": `${at.y}px`,
    "--d": `${delay}ms`,
    ...(from ? { "--fx": `${from.x}px`, "--fy": `${from.y}px` } : {}),
  } as CSSProperties;
  return (
    <g className={`story-coin ${safe ? "safe" : ""}`} style={style}>
      <g>
        <g>
          <circle r="9" fill="#e2bb55" stroke="#8f6d1f" strokeWidth="1.5" />
          <circle r="5.4" fill="none" stroke="#f6dc8a" strokeWidth="1.3" />
          <path d="M-4.6 -3.4a6 6 0 0 1 4-2.6" fill="none" stroke="#fff6d2" strokeWidth="1.6" strokeLinecap="round" />
        </g>
      </g>
    </g>
  );
}
function Wallet({ x, y, w, h, label }: { x: number; y: number; w: number; h: number; label: string }) {
  return (
    <g className="story-wallet">
      <rect x={x} y={y} width={w} height={h} rx="9" />
      <path d={`M${x} ${y + h * 0.24}h${w}`} />
      <rect className="clasp" x={x + w - w * 0.2} y={y + h * 0.4} width={w * 0.2 + 5} height={h * 0.26} rx="5" />
      <circle className="stud" cx={x + w - w * 0.07} cy={y + h * 0.53} r="2.2" />
      <text className="story-label" x={x + w / 2} y={y + h + 20} textAnchor="middle">
        {label}
      </text>
    </g>
  );
}
function Thief({ at, label, children }: { at: Point; label: string; children?: ReactNode }) {
  return (
    <g transform={`translate(${at.x} ${at.y})`}>
      <g className="story-thief">
        {children}
        <g className="story-thief-body">
          <g transform="scale(1.4)">
            <path d="M0 -30c14 0 23 10 23 25v31h-46v-31c0-15 9-25 23-25z" fill="#2a1512" stroke="#f39687" strokeWidth="1.9" />
            <path d="M-15 -3c0-9 6-15 15-15s15 6 15 15c0 7-6 11-15 11s-15-4-15-11z" fill="#0a0a0a" stroke="#f39687" strokeWidth="1.5" />
            <path className="story-eyes" d="M-10 -4l8 2M10 -4l-8 2" stroke="#f39687" strokeWidth="2.4" strokeLinecap="round" />
          </g>
        </g>
        <text className="story-label coral" y="-50" textAnchor="middle">
          {label}
        </text>
      </g>
    </g>
  );
}
/** The bait: it looks like a present, and it sits exactly where the thief turns up. */
function Bait({ at, label }: { at: Point; label: string }) {
  return (
    <g transform={`translate(${at.x} ${at.y})`}>
      <circle className="story-ripple" r="14" />
      <g className="story-bait">
        <rect x="-26" y="-6" width="52" height="30" rx="3" />
        <rect x="-29" y="-17" width="58" height="12" rx="3" />
        <path d="M0 -17v41M0 -18c-5 -11 -17 -9 -11 -2c3 3 8 3 11 2c3 1 8 1 11 -2c6 -7 -6 -9 -11 2z" />
        <text y="15" textAnchor="middle">
          {label}
        </text>
      </g>
    </g>
  );
}
function Stamp({ name, at, turn, text }: { name: string; at: Point; turn: number; text: string }) {
  const w = text.length * 6.7 + 18;
  return (
    <g transform={`translate(${at.x} ${at.y}) rotate(${turn})`}>
      <g className={`story-stamp story-${name}`}>
        <rect x={-w / 2} y="-10.5" width={w} height="21" rx="2.5" />
        <text y="3.4" textAnchor="middle">
          {text}
        </text>
      </g>
    </g>
  );
}
function Key({ kind }: { kind: "wallet" | "bunker" }) {
  return (
    <g transform="translate(-34 0)">
      <g className={`story-key ${kind}`}>
        <path d="M0 0h19M3 0v5M8 0v4" />
        <circle cx="24" cy="0" r="5" />
      </g>
    </g>
  );
}
function Cursor({ from, to }: { from: Point; to: Point }) {
  const style = {
    "--cx0": `${from.x}px`,
    "--cy0": `${from.y}px`,
    "--cx1": `${to.x}px`,
    "--cy1": `${to.y}px`,
  } as CSSProperties;
  return (
    <g className="story-cursor" style={style}>
      <path d="M0 0v17l4.5-4 3 7 3-1.3-2.9-6.7h5.9z" />
    </g>
  );
}

export default function Story() {
  const t = TEXT.en;
  const [beat, setBeat] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [seen, setSeen] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  // Starts by itself the first time it scrolls into view, unless the visitor
  // has asked for less motion; then it waits to be stepped through.
  useEffect(() => {
    const el = stage.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const watch = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started.current) {
          started.current = true;
          setSeen(true);
          setPlaying(true);
        }
        if (!entry.isIntersecting) setPlaying(false);
      },
      { threshold: 0.45 },
    );
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  // Playing means advancing; at the last beat there is nothing left to play.
  const running = playing && beat < LAST;
  useEffect(() => {
    if (!running) return;
    const t = setTimeout(() => setBeat((b) => Math.min(b + 1, LAST)), HOLD_MS[beat]);
    return () => clearTimeout(t);
  }, [running, beat]);

  const go = (b: number) => {
    setPlaying(false);
    setSeen(true);
    setBeat(b);
  };
  const taken = beat >= 2;
  const b = t.beats[beat];
  return (
    <div className="story" data-beat={beat} data-seen={seen ? "" : undefined} ref={stage}>
      <div className="story-lanes" aria-hidden="true">
        {/* Without a Bunker */}
        <div className="story-lane without">
          <svg viewBox="0 0 400 300">
            <text className="story-tag" x="20" y="27">
              {t.without.toUpperCase()}
            </text>
            <Wallet x={28} y={160} w={132} h={102} label={t.wallet} />
            <path className="story-hook" pathLength="1" d="M300 104C252 150 204 152 158 184" />
            {HEAP.map((heap, i) => (
              <Coin key={i} at={taken ? heap : walletHome(i)} delay={taken ? 150 + i * 70 : i * 45} />
            ))}
            <Thief at={{ x: 330, y: 76 }} label={t.thief} />
            <Bait at={{ x: 330, y: 76 }} label={t.free} />
            <Stamp name="bad" at={{ x: 246, y: 60 }} turn={-6} text={t.badClick} />
            <Cursor from={{ x: 236, y: 196 }} to={{ x: 334, y: 82 }} />
            <text className="story-count" x="382" y="286" textAnchor="end">
              {taken ? "0" : "10"}
            </text>
          </svg>
        </div>
        {/* With a Bunker */}
        <div className="story-lane with">
          <svg viewBox="0 0 400 300">
            <text className="story-tag ice" x="20" y="27">
              {t.with.toUpperCase()}
            </text>
            <Wallet x={24} y={196} w={76} h={66} label={t.wallet} />
            <g className="story-bunker">
              <path className="shell" d="M140 270V164a62 62 0 0 1 124 0v106z" />
              <path className="floor" d="M134 270h136" />
              <path className="shelf" d="M152 222h100M152 250h100" />
              <text className="story-label ice" x="202" y="124" textAnchor="middle">
                {t.bunker}
              </text>
              <g transform="translate(202 156)">
                <circle className="story-pulse" r="22" />
                <g className="story-wheel">
                  <circle r="19" />
                  <path d="M0 -19v38M-16.5 -9.5l33 19M-16.5 9.5l33 -19" />
                  <circle className="hub" r="5.5" />
                </g>
              </g>
              <g className="story-keyhole">
                <circle cx="246" cy="155" r="3" />
                <path d="M246 156v6" />
              </g>
            </g>
            <circle className="story-shock" cx="202" cy="170" r="40" />
            <path className="story-hook" pathLength="1" d="M284 104C232 44 122 62 92 200" />
            {[0, 1].map((i) => (
              <Coin key={`p${i}`} at={taken ? pocketLoot(i) : pocketHome(i)} delay={taken ? 150 + i * 90 : 0} />
            ))}
            {Array.from({ length: 8 }, (_, i) => (
              <Coin key={`b${i}`} at={bunkerHome(i)} from={purseHome(i + 2)} delay={i * 90} safe />
            ))}
            <Thief at={{ x: 312, y: 76 }} label={t.thief}>
              <Key kind="wallet" />
              <Key kind="bunker" />
              <path className="story-sparks" d="M-70 -9l-7 -6M-72 0h-9M-70 9l-7 6" />
            </Thief>
            <Bait at={{ x: 312, y: 76 }} label={t.free} />
            <Stamp name="bad" at={{ x: 226, y: 46 }} turn={-6} text={t.badClick} />
            <Stamp name="denied" at={{ x: 202, y: 185 }} turn={-5} text={t.wrongKey} />
            <g className="story-timer" transform="translate(202 66)">
              <circle r="21" />
              <circle className="run" r="21" pathLength="100" transform="rotate(-90)" />
              <path className="hand" d="M0 0v-13" />
              <text x="29" y="3.4">
                24h
              </text>
            </g>
            <g transform="translate(62 104)">
              <g className="story-phone">
                <rect x="-31" y="-52" width="62" height="104" rx="9" />
                <circle className="story-ring" cy="-22" r="12" />
                <g transform="translate(0 -22)">
                  <path className="story-bell" d="M-9 6h18c-3 -3 -3 -6 -3 -10a6 6 0 0 0 -12 0c0 4 0 7 -3 10zM-2.5 9.5a2.6 2.6 0 0 0 5 0" />
                </g>
                <g transform="translate(0 24)">
                  <g className="story-stop">
                    <rect x="-23" y="-13" width="46" height="26" rx="5" />
                    <text y="3.4" textAnchor="middle">
                      {t.stop}
                    </text>
                  </g>
                </g>
              </g>
            </g>
            <Stamp name="cancelled" at={{ x: 202, y: 185 }} turn={-7} text={t.cancelled} />
            <Cursor from={{ x: 262, y: 214 }} to={{ x: 316, y: 82 }} />
            <g className="story-press">
              <Cursor from={{ x: 132, y: 196 }} to={{ x: 66, y: 132 }} />
            </g>
            <text className="story-count" x="382" y="286" textAnchor="end">
              8
            </text>
          </svg>
        </div>
      </div>

      {/* The words, for everyone, and the whole story for a screen reader. */}
      <div className="story-words" aria-live="polite">
        <h3>{b.title}</h3>
        <div>
          <p>
            <span>{t.without}</span>
            {b.without}
          </p>
          <p className="ice">
            <span>{t.with}</span>
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
          aria-label={beat === LAST ? t.playAgain : running ? t.pause : t.play}
        >
          {beat === LAST ? <RotateCcw size={15} /> : running ? <Pause size={15} /> : <Play size={15} />}
          {beat === LAST ? t.again : running ? t.pause : t.play}
        </button>
        <div className="story-dots" role="tablist" aria-label={t.steps}>
          {t.beats.map((x, i) => (
            <button
              key={x.title}
              role="tab"
              aria-selected={i === beat}
              aria-label={t.step(i + 1, t.beats.length, x.title)}
              className={i === beat ? "on" : i < beat ? "done" : ""}
              onClick={() => go(i)}
            />
          ))}
        </div>
        <span className="story-note">{t.note}</span>
      </div>
    </div>
  );
}
