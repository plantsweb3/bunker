import type { Metadata } from "next";
import Link from "next/link";
import { Header, Footer } from "@/components/bunker/shell";
import FilmPlayer from "@/components/bunker/film";
import Loop from "@/components/bunker/loop";

const POSTER = "/assets/film/while-they-read-poster.jpg";
export const metadata: Metadata = {
  title: "Roadmap",
  description:
    "The plan for Bunker, as five doors. Gates, not dates: each step waits for the one before. Public beta.",
  openGraph: {
    title: "Bunker roadmap: gates, not dates",
    description: "Five doors. Each step waits for the one before. Public beta.",
    images: [{ url: POSTER, width: 1280, height: 720, alt: "Door 01 of the plan: a steel door standing open on a lit room." }],
  },
  twitter: { card: "summary_large_image", images: [POSTER] },
};
/** The five steps, in the film's words. */
const doors: { file: string; name: string; chip: string; line: string }[] = [
  { file: "door-01-watch", name: "Watch", chip: "Out now", line: "Built. Alerts when a withdrawal is announced. Holds no keys." },
  { file: "door-02-signer-drawn", name: "Signer, drawn", chip: "Design only", line: "Designed. Not built, not shipped." },
  { file: "door-03-the-report", name: "The report", chip: "Published", line: "Out in the open. Every finding resolved or acknowledged, and the one fix is live." },
  { file: "door-04-signer-built", name: "Signer, built", chip: "After the red ink", line: "Only on the code the audit covered, plus its fixes." },
  { file: "door-05-build-on-bunker", name: "Build on Bunker", chip: "Next", line: "Phone alerts, integrations, a cancel-file helper. Each reviewed first." },
];
function Door({ n }: { n: number }) {
  const door = doors[n];
  const number = String(n + 1).padStart(2, "0");
  const at = `/assets/roadmap/${door.file}`;
  const inside = (
    <>
      <div className="door-picture">
        <Loop onScreenOnly src={[`${at}.mp4`, `${at}.webm`]} poster={`${at}-poster.jpg`} />
      </div>
      <div className="door-words">
        <span className="door-label">
          THE PLAN · DOOR {number} / 05
        </span>
        <span className="door-strip" aria-hidden="true">
          {doors.map((d, i) => (
            <i key={d.file} className={i === n ? "on" : ""} />
          ))}
        </span>
        <h2 className="bm-big">
          Door {number}.<span className="bm-accent">{door.name}.</span>
        </h2>
        <span className={`bm-chip ${n === 0 ? "bm-chip--ice" : "bm-chip--cream"}`}>{door.chip}</span>
        <p>{door.line}</p>
        {n === 0 && <span className="door-open">Open Bunker Watch →</span>}
      </div>
    </>
  );
  // The first door is open: the whole panel is the way in.
  return (
    <li className="door">
      {n === 0 ? (
        <Link className="door-panel" href="/watch">
          {inside}
        </Link>
      ) : (
        <div className="door-panel">{inside}</div>
      )}
    </li>
  );
}
export default function Roadmap() {
  return (
    <>
      <Header />
      <main className="roadmap">
        <section className="roadmap-hero">
          <h1 className="bm-big">
            The plan.
            <span className="bm-accent">Gates, not dates.</span>
          </h1>
          <div className="bm-panel roadmap-film">
            <div className="bm-panel__head">
              <span>While They Read</span>
              <span>1:51</span>
            </div>
            <FilmPlayer film="roadmap" />
          </div>
        </section>
        <ol className="doors">
          {doors.map((door, n) => (
            <Door key={door.file} n={n} />
          ))}
        </ol>
        <section className="roadmap-end">
          <p>Roadmap, not a promise of dates. Each step waits for the one before.</p>
          <span className="mono">PUBLIC BETA · PROGRAM AUDITED BY CERTIK</span>
        </section>
      </main>
      <Footer />
    </>
  );
}
