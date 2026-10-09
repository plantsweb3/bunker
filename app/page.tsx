import Image from "next/image";
import Link from "next/link";
import {
  Play,
  MoveUpRight,
  Check,
  X,
  LockKeyhole,
} from "lucide-react";
import { Header, Footer } from "@/components/bunker/shell";
import Story from "@/components/bunker/story";
import { Card, Clip } from "@/components/bunker/loop";
import FilmPlayer from "@/components/bunker/film";
import { BIcon } from "@/components/bunker/icon";
function Plate({
  clip,
  level,
  line,
  tall = false,
}: {
  clip: string;
  level: string;
  line: string;
  tall?: boolean;
}) {
  return (
    <section className={`world-plate ${tall ? "tall" : ""}`}>
      <Clip name={clip} />
      <span className="halftone" />
      <div>
        <span className="mono">{level}</span>
        <p>{line}</p>
      </div>
    </section>
  );
}
const REPO = "https://github.com/plantsweb3/bunker";
const X_URL = "https://x.com/BunkerModeIO";
const stops: [string, string][] = [
  ["A bad click.", "Tricking your wallet does not open your Bunker."],
  ["A stolen seed phrase.", "Your seed phrase does not make the Bunker key."],
  ["Using a key twice.", "Every key works once. Each withdrawal makes a new one."],
  [
    "A stolen day key, while the wait is on.",
    "It can pay only the wallets you listed as yours. Anything else waits a day, and you press stop.",
  ],
];
const limits: [string, string][] = [
  ["A virus on your device.", "It can copy your key file and watch you type the password."],
  ["A stolen day key, if you turn the wait off.", "Then a thief can send everything anywhere, at once."],
  [
    "A trusted wallet that is not safe.",
    "A thief with your day key can pay it right away. Make it a wallet they cannot reach.",
  ],
  ["A lost recovery kit.", "Nobody can reset it. Not even us."],
];
/** The film's status line. */
const ticker = [
  "NOT AUDITED",
  "WAITING PERIOD: YOUR CHOICE",
  "PROTECTS THE WITHDRAWAL PATH, NOT THE CHAIN",
  "A KEY IS NOT PERMISSION",
  "PREPARE. DON’T PANIC.",
  "CURVE BREAK: HYPOTHETICAL",
  "WALLET KEY: PAYS, CAN’T WITHDRAW",
  "ONE KEY, ONE MESSAGE",
  "REAL-FUND CUSTODY: OFF",
];
/** How the door works, told with the film's own cards. All of it is simulation with demo values. */
const works: { label: string; media: React.ReactNode; title: string; body: string; cream?: boolean }[] = [
  {
    label: "ONE-TIME KEY",
    media: <Clip name="key-turns-to-ash" />,
    title: "Every key works once.",
    body: "Use it and it is gone. The next one is already made.",
  },
  {
    label: "SIGNED WITHDRAWAL",
    media: <Card name="signed-withdrawal-form" />,
    title: "The key signs the whole withdrawal.",
    body: "Which coin, how much, where to. Change one digit and the signature fails. Nothing moves.",
    cream: true,
  },
  {
    label: "34 HASH CHAINS",
    media: <Card name="34-chain-ring" />,
    title: "A key is 34 chains of hashes.",
    body: "One-time signatures of the kind written down in RFC 8554 (LM-OTS). Their security rests on SHA-256 alone. The rest of Solana stays as it is.",
  },
  {
    label: "TRUSTED ADDRESSES",
    media: <Card name="trusted-addresses" />,
    title: "Up to four wallets of your own.",
    body: "You pick them when you build the Bunker. After that they can’t be changed.",
  },
  {
    label: "WAITING PERIOD",
    media: <Card name="waiting-period-timer" />,
    title: "Everything else waits.",
    body: "You choose the wait: up to seven days, or off. While it runs, your stop button cancels.",
  },
];
const gates: [string, string, string][] = [
  [
    "Public source and tests",
    "Everything that holds or moves funds is public, with the tests that attack it.",
    "Open",
  ],
  [
    "Deployment you can verify",
    "The published source matched to the deployed program, with a written rule that nobody can change it afterwards.",
    "Pending",
  ],
  [
    "Public beta",
    "Real vaults, unaudited, at your own risk. Not open yet.",
    "Pending",
  ],
  [
    "Bug bounties",
    "Rewards for breaking it. The scope and the amounts are not final yet.",
    "Planned",
  ],
  [
    "Independent audit",
    "None has been done and none is booked. If that changes, the report goes here.",
    "Not booked",
  ],
];
const faq: [string, React.ReactNode][] = [
  [
    "Is Bunker a wallet?",
    <>
      No. You keep the wallet you already use. Bunker is a separate vault on
      Solana for the assets you are not actively moving. Your wallet pays
      network fees; it cannot authorize a withdrawal from the vault.
    </>,
  ],
  [
    "Can I put real funds in today?",
    <>
      No. This is a pre-release. The mainnet site can read balances but cannot
      create a vault or move assets, and no Bunker program is deployed on
      mainnet. That stays true until the public beta opens; see the{" "}
      <Link href="#road">road to the beta</Link>.
    </>,
  ],
  [
    "I already use a hardware wallet. Why would I need this?",
    <>
      A hardware wallet keeps your key off your computer. It still signs
      whatever you approve, including a drainer’s transaction. Bunker does a
      different job: assets in the vault cannot be moved by your wallet’s
      signature at all. The two work together, and a hardware wallet is the
      ideal trusted address for a Bunker to pay out to.
    </>,
  ],
  [
    "What if someone steals my Bunker key?",
    <>
      When you build a Bunker you list up to four trusted addresses and
      choose how long anything else waits, 24 hours unless you change it. A
      thief with your day key can send at once only to those addresses,
      which are yours. A withdrawal anywhere else waits in the open for
      the whole wait. Your stop button cancels it, and your recovery kit then
      makes a new key. If you turn the wait off, a stolen day key can take everything
      immediately.
    </>,
  ],
  [
    "What happens if I lose my recovery kit or its password?",
    <>
      Your day key keeps working, so nothing is lost that day. But the kit is
      the only thing that can replace a lost or stolen day key, and nobody,
      including the people who build Bunker, can reset it. Lose both and the
      vault cannot be opened. That is the cost of having no back door, and it
      is why the tool makes you prove the kit is saved before anything is
      built.
    </>,
  ],
  [
    "What if Bunker goes away?",
    <>
      A vault is controlled by an on-chain program, not by this website, and
      the program gives nobody an administrator role over a vault. The policy
      for real funds is that the program is deployed so that nobody, us
      included, can change it afterwards; that deployment has not happened
      and will be published, with proof, when it does. The code that builds a withdrawal is{" "}
      <a href={REPO} target="_blank" rel="noreferrer">
        public
      </a>
      . The recovery tool is a file you keep and runs without this site, and
      there is a command-line program, in one file you can download and keep,
      that withdraws and submits recovery packets with nothing but your key
      files and a Solana connection. It needs a computer with Node, and like
      this site it works on test networks only.
    </>,
  ],
  [
    "What does it cost?",
    <>
      The pre-release is free to explore. The custody program has no fee and no
      administrator role. You pay ordinary Solana network fees and account rent
      from your own wallet. Pricing for anything beyond that has not been set.
    </>,
  ],
  [
    "Has it been audited?",
    <>
      No, and no audit is booked. The source is public so that anyone can
      review it, and Bunker will open as a public beta with bug bounties,
      which are not final yet. Readable source and passing tests are not an
      audit. <Link href="/security">Read the limits.</Link>
    </>,
  ],
];
export default function Home() {
  return (
    <>
      <Header />
      <main className="descent">
        <section className="hero film">
          <div className="hero-stage">
            {/* The film's title hit. The still is the poster, and all that a
                visitor who asked for less motion is shown. */}
            <Image
              fill
              priority
              unoptimized
              sizes="100vw"
              className="hero-image"
              src="/assets/film/poster.jpg"
              alt="The words BUNKER MODE over a night city of data-center towers, framed like a film still and labelled as a simulation"
            />
            <video
              className="hero-image hero-loop"
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              poster="/assets/film/poster.jpg"
              aria-hidden="true"
            >
              <source src="/assets/film/hero-loop.webm" type="video/webm" />
              <source src="/assets/film/hero-loop.mp4" type="video/mp4" />
            </video>
          </div>
          <div className="hero-content bm-panel">
            <div className="hero-chips">
              <span className="bm-chip bm-chip--ice">Pre-release</span>
              <span className="bm-chip bm-chip--cream">Real funds not accepted</span>
            </div>
            <h1>
              One bad click{" "}
              <br />
              shouldn’t cost you{" "}
              <br />
              <em>everything.</em>
            </h1>
            <p>
              Bunker is a safe for your crypto. Your wallet can’t open it.
              So a thief who tricks your wallet can’t empty it.
            </p>
            <div className="actions">
              <Link href="#how" className="button light">
                <Play size={15} fill="currentColor" />
                Show me
              </Link>
              <Link href="/demo" className="button ghost">
                Try it yourself
              </Link>
            </div>
            <div className="hero-more">
              <div className="hero-note">
                <BIcon name="bunker-key" size={15} />
                Your wallet puts money in. A different key takes it out.
              </div>
              <Link className="hero-lang" href="/es" hrefLang="es" lang="es">
                Español
              </Link>
            </div>
            <div className="ca-line" aria-label="Contract address coming soon">
              <span className="ca-label">CA</span>
              <span className="ca-typed" aria-hidden="true">
                contract address coming soon...
              </span>
            </div>
          </div>
        </section>
        <div className="bm-ticker" aria-hidden="true">
          <span className="bm-ticker__track">
            {[0, 1].map((half) => (
              <span key={half}>
                {ticker.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </span>
            ))}
          </span>
        </div>
        <section className="principles">
          <span>
            <BIcon name="everyday-wallet" />A bad click can’t empty it
          </span>
          <span>
            <BIcon name="recovery-kit" />
            A stolen seed phrase can’t open it
          </span>
          <span>
            <BIcon name="lock-changed" />
            Every key works only once
          </span>
          <Link href="#limits">
            Where the protection stops
            <MoveUpRight size={16} />
          </Link>
        </section>
        <section className="intro section" id="how">
          <div className="eyebrow">
            <b>01 / SURFACE</b>WATCH. NO READING NEEDED.
          </div>
          <div className="split-title">
            <h2>
              Same mistake.
              <br />
              Two endings.
            </h2>
            <p>
              Everyone clicks the wrong thing one day. Watch what happens
              next, with a Bunker and without one.
            </p>
          </div>
          <Story />
          <div className="way-in">
            <h3>Your way in. Three small steps.</h3>
            <ol>
              <li>
                <Link href="/check">
                  <span className="way-num">1</span>
                  <BIcon name="everyday-wallet" size={34} />
                  <b>Look</b>
                  <span>See what one bad click could take from your wallet. Nothing to connect.</span>
                  <em>Check my wallet</em>
                </Link>
              </li>
              <li>
                <Link href="/demo">
                  <span className="way-num">2</span>
                  <BIcon name="simulation" size={34} />
                  <b>Practice</b>
                  <span>Get robbed on purpose, with pretend money. See what a Bunker changes.</span>
                  <em>Try the practice run</em>
                </Link>
              </li>
              <li>
                <Link href="/recovery">
                  <span className="way-num">3</span>
                  <BIcon name="vault" size={34} />
                  <b>Build</b>
                  <span>Make your own Bunker. Today it works with test money only.</span>
                  <em>Build my Bunker</em>
                </Link>
              </li>
            </ol>
          </div>
        </section>
        <section className="check-teaser section surface" data-level="01">
          <Clip name="porch-lights-walkway" className="backdrop" />
          <span className="halftone" />
          <div>
            <div className="eyebrow">
              <b>01 / SURFACE</b>YOUR TURN. TEN SECONDS.
            </div>
            <h2>
              What could one bad click
              <br />
              take from you?
            </h2>
            <p>
              Paste any Solana address. See everything one bad click could
              take, and anything you already gave someone permission to move.
            </p>
          </div>
          <form className="check-form" action="/check" method="get">
            <label className="field">
              <span>Solana wallet address</span>
              <input
                name="a"
                required
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="Paste a wallet address"
              />
            </label>
            <button className="button light">Check wallet</button>
            <span className="micro">
              Read-only. Public chain data. Nothing is stored.
            </span>
          </form>
        </section>
        <Plate
          tall
          clip="wallet-at-vault-door"
          level="02 / THRESHOLD"
          line="Your wallet key stops here."
        />
        <section className="demo-teaser section" data-level="02">
          <div>
            <div className="eyebrow">
              <b>02 / THRESHOLD</b>SEE IT IN ONE MINUTE
            </div>
            <h2>
              Sign the fake airdrop.
              <br />
              See what’s left.
            </h2>
            <p>
              Move a simulated balance into Bunker, fall for a simulated
              drainer, and watch what it can and can’t take.
            </p>
            <Link className="button light" href="/demo">
              <Play size={15} />
              Run the simulation
            </Link>
            <span className="micro">
              No wallet. No funds. Clearly labeled simulation.
            </span>
          </div>
          <div className="flow-preview">
            <div className="flow-top">
              <span className="mono">SIMULATION / AFTER THE DRAIN</span>
              <LockKeyhole size={18} />
            </div>
            <div className="flow-row drained-row">
              <span className="asset-logo">≋</span>
              <div>
                <strong>Everyday wallet</strong>
                <span>Signed a drainer’s transaction</span>
              </div>
              <span className="mono">EMPTIED</span>
            </div>
            <div className="flow-line">
              <span />
              <span className="mono">WALLET KEY STOPS HERE</span>
              <span />
            </div>
            <div className="flow-row bunker-row">
              <BIcon name="vault" size={26} />
              <div>
                <strong>Your Bunker</strong>
                <span>Needs a key the drainer never saw</span>
              </div>
              <Check size={20} />
            </div>
            <div className="flow-bottom">
              Illustration of the design goal, not a security proof.
            </div>
          </div>
        </section>
        <section className="section valve">
          <div>
            <div className="eyebrow">
              <b>02 / THRESHOLD</b>BUNKER MODE
            </div>
            <h2>
              Trade from a wallet.
              <br />
              Keep it in a Bunker.
            </h2>
            <p>
              A trading wallet has to be fast, so it is easy to rob. Sweep
              what you want to keep into your Bunker. Anything can go in, from
              any wallet. Nothing comes out with that wallet’s key.
            </p>
            <Link className="button ghost" href="/integrate">
              Bunker beside a trading terminal
              <MoveUpRight size={15} />
            </Link>
          </div>
          <div className="valve-diagram" aria-hidden="true">
            <div className="valve-node hot">
              <span className="mono">TRADING WALLET</span>
              <strong>Fast key. Exposed.</strong>
            </div>
            <div className="valve-pipe">
              <span className="pipe in">
                <i />
                IN · ANY WALLET
              </span>
              <span className="pipe out">
                <X size={12} />
                OUT · NOT WITH THIS KEY
              </span>
            </div>
            <div className="valve-node cold">
              <span className="mono">YOUR BUNKER</span>
              <strong>Sealed. Separate key.</strong>
            </div>
          </div>
        </section>
        <Plate
          clip="key-being-cut"
          level="03 / INSIDE"
          line="Past this point, the keys are yours."
        />
        <section className="section role" data-level="03">
          <div className="eyebrow">
            <b>03 / INSIDE</b>WHAT YOU HOLD
          </div>
          <div className="split-title">
            <h2>
              Four things.
              <br />
              You hold all of them.
            </h2>
            <p>
              Nobody at Bunker has a copy, and there is no reset button. That
              is what keeps a thief out, and it is why these four matter.
            </p>
          </div>
          <ol className="hold-grid">
            <li>
              <div className="hold-pic wallet" aria-hidden="true">
                <span className="p-wallet" />
                <span className="p-coin a" />
                <span className="p-coin b" />
                <span className="p-reach" />
              </div>
              <h3>Your wallet</h3>
              <strong>For spending.</strong>
              <p>Keep a little here. A thief can reach it.</p>
            </li>
            <li>
              <div className="hold-pic key" aria-hidden="true">
                <span className="p-door" />
                <span className="p-key" />
                <span className="p-coin out" />
              </div>
              <h3>Your day key</h3>
              <strong>Opens the door.</strong>
              <p>To your own wallets: right away. To anyone else: after a day.</p>
            </li>
            <li>
              <div className="hold-pic stop" aria-hidden="true">
                <span className="p-ring" />
                <span className="p-stop">STOP</span>
              </div>
              <h3>Your stop button</h3>
              <strong>Stops a thief.</strong>
              <p>One file. Keep it close. It cancels a withdrawal you did not make.</p>
            </li>
            <li>
              <div className="hold-pic kit" aria-hidden="true">
                <span className="p-drawer" />
                <span className="p-box" />
              </div>
              <h3>Your recovery kit</h3>
              <strong>Makes new keys.</strong>
              <p>Hide it. Never on the internet. Never shown to a website, not even this one.</p>
            </li>
          </ol>
        </section>
        <section className="section works" id="works">
          <div className="eyebrow">
            <b>03 / INSIDE</b>HOW THE DOOR WORKS
          </div>
          <div className="split-title">
            <h2>
              Five ideas.
              <br />
              No new cryptography.
            </h2>
            <p>
              Pictures from the film. Every screen in them is a simulation
              with made-up values. Bunker is pre-release.
            </p>
          </div>
          <ol className="works-grid">
            {works.map((w) => (
              <li key={w.label} className={`bm-panel ${w.cream ? "cream" : ""}`}>
                <div className="bm-panel__head">
                  <span>{w.label}</span>
                  <span>SIMULATION</span>
                </div>
                <div className="works-media">{w.media}</div>
                <h3>{w.title}</h3>
                <p>{w.body}</p>
              </li>
            ))}
          </ol>
        </section>
        <section className="section limits weather" id="limits">
          <Clip name="padlocks-falling" className="backdrop" />
          <span className="halftone" />
          <div className="eyebrow">
            <b>03 / INSIDE</b>HONEST ABOUT THE EDGES
          </div>
          <h2>
            What it stops.
            <br />
            What it can’t.
          </h2>
          <div className="limits-grid">
            <div>
              <h3>Built to stop</h3>
              <ul>
                {stops.map(([lead, rest]) => (
                  <li key={lead}>
                    <Check size={16} className="ice" />
                    <span>
                      <b>{lead}</b> {rest}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3>Does not stop</h3>
              <ul>
                {limits.map(([lead, rest]) => (
                  <li key={lead}>
                    <X size={16} />
                    <span>
                      <b>{lead}</b> {rest}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="limits-note">
            This is what it is built to do. Outside experts have not checked
            it yet. <Link href="/security">Read every limit.</Link>
          </p>
        </section>
        <section className="truth section" id="road" data-level="04">
          <div className="eyebrow">
            <b>04 / FOUNDATIONS</b>ROAD TO THE BETA
          </div>
          <h2>
            Security is a process.
            <br />
            Not a promise on a website.
          </h2>
          <div className="truth-grid">
            <div>
              <p>
                Bunker has not been audited. It opens as a public beta
                instead: public code, public tests, and bug bounties for
                people who break it. Until the beta opens, this site works
                with test money only.
              </p>
              <div className="actions road-actions">
                <a
                  className="button light"
                  href={X_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  Follow @BunkerModeIO on X
                </a>
                <Link className="button ghost" href="/verify">
                  Inspect deployment & source
                </Link>
              </div>
            </div>
            <ol className="road-list">
              {gates.map(([title, body, state], i) => (
                <li key={title}>
                  <span className="mono">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <strong>{title}</strong>
                    <span>{body}</span>
                  </div>
                  <b>{state}</b>
                </li>
              ))}
            </ol>
          </div>
        </section>
        <section className="section faq">
          <div className="eyebrow">
            <b>04 / FOUNDATIONS</b>QUESTIONS
          </div>
          <h2>Before you ask.</h2>
          <div className="faq-list">
            {faq.map(([q, a]) => (
              <details key={q}>
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>
        <section className="section film-section" id="film">
          <div className="eyebrow">
            <b>04 / FOUNDATIONS</b>THE FILM
          </div>
          <div className="film-head">
            <h2 className="bm-big">
              Watch
              <span className="bm-accent">the film.</span>
            </h2>
            <div>
              <div className="hero-chips">
                <span className="bm-chip">Music video · 4:06</span>
                <span className="bm-chip bm-chip--ice">Simulation</span>
              </div>
              <p>
                A film about one-time keys. The product screens in it are a
                simulation: Bunker is pre-release, no Bunker program is on
                mainnet, real funds are not accepted, and it has not been
                audited.
              </p>
            </div>
          </div>
          <FilmPlayer />
          <p className="micro">
            Bunker protects the way out of your vault, not the chain it lives
            on. The pull request, the test names and “DEMO-TOKEN” in the film
            are made up. The lyrics are in the picture; captions can be turned
            on in the player.
          </p>
        </section>
        <section className="closing section room">
          <Clip name="city-going-under" className="backdrop" />
          <span className="halftone" />
          <span className="eyebrow">PREPARE. DON’T PANIC.</span>
          <h2>Step inside.</h2>
          <div className="actions">
            <Link href="/demo" className="button light">
              Run the simulation
            </Link>
            <Link href="/check" className="button ghost">
              Check a wallet
            </Link>
          </div>
        </section>
      </main>
      <nav className="mobile-dock" aria-label="Quick actions">
        <Link href="/check">Check a wallet</Link>
        <Link href="/demo">Run the demo</Link>
      </nav>
      <Footer />
    </>
  );
}
