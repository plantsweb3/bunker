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
import { BIcon, BunkerIconName } from "@/components/bunker/icon";
function Plate({
  src,
  alt,
  level,
  line,
  tall = false,
}: {
  src: string;
  alt: string;
  level: string;
  line: string;
  tall?: boolean;
}) {
  return (
    <section className={`world-plate ${tall ? "tall" : ""}`}>
      <Image unoptimized fill sizes="100vw" src={src} alt={alt} />
      <div>
        <span className="mono">{level}</span>
        <p>{line}</p>
      </div>
    </section>
  );
}
const REPO = "https://github.com/plantsweb3/bunker";
const X_URL = "https://x.com/BunkerModeIO";
const stops = [
  "A drainer site that tricks your wallet into signing. A wallet signature alone cannot move what is in the vault.",
  "A stolen or leaked seed phrase. Your seed phrase does not produce the Bunker key.",
  "A reused authorization. Every successful withdrawal replaces the key in the same transaction.",
  "A stolen Bunker key, while the wait is on. It can pay only the addresses you fixed when you built your Bunker. Anything else waits a day, and you can cancel it.",
];
const limits = [
  "Malware on the device where you open your keys. It can copy a key file and record its password.",
  "A stolen day key, if you turn the wait off. Whoever has it and its password can then withdraw anywhere at once.",
  "A trusted address that is not safe. Whoever steals your day key can send everything to a trusted address immediately, so it has to be a wallet they cannot also reach.",
  "A lost recovery kit. There is no reset and no administrator, and it is the only thing that replaces a lost key.",
];
const gates = [
  [
    "Cryptographic review",
    "An independent assessment of the signature construction and Bunker’s use of it.",
  ],
  [
    "Program audit",
    "An independent audit of the on-chain program that holds and releases assets.",
  ],
  [
    "Recovery and signing review",
    "Stale backups, multiple devices, interrupted withdrawals and browser isolation.",
  ],
  [
    "Deployment verification",
    "Reviewed source matched to the deployed program, with a published upgrade policy.",
  ],
  [
    "Operational readiness",
    "Dedicated infrastructure, monitoring, incident ownership and a scoped bounty.",
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
      mainnet. That stays true until the work on the{" "}
      <Link href="#road">road to mainnet</Link> is complete.
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
      which are yours. A withdrawal anywhere else sits in public for the
      whole wait, and your recovery kit cancels it and replaces the stolen
      key. If you turn the wait off, a stolen day key can take everything
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
      No. The source is public so that it can be reviewed, and independent
      review is the first gate before real funds. Readable source and passing
      tests are not an audit. <Link href="/security">Read the limits.</Link>
    </>,
  ],
];
export default function Home() {
  return (
    <>
      <Header />
      <main className="descent">
        <section className="hero">
          <Image
            fill
            priority
            sizes="100vw"
            className="hero-image"
            src="/assets/bunker-hero.png"
            alt="A monumental concrete bunker set into a basalt landscape, with a narrow illuminated entrance"
          />
          {/* Mist and door light only; the still above is the poster and the
              reduced-motion fallback. */}
          <video
            className="hero-image hero-loop"
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            poster="/assets/bunker-hero.png"
            aria-hidden="true"
          >
            <source src="/assets/video/hero-loop.webm" type="video/webm" />
            <source src="/assets/video/hero-loop.mp4" type="video/mp4" />
          </video>
          <div className="hero-shade" />
          <div className="hero-content">
            <div className="eyebrow">
              <span className="tiny-line" />
              PREPARE. DON’T PANIC.
            </div>
            <h1>
              One bad signature
              <br />
              shouldn’t cost you
              <br />
              <em>everything.</em>
            </h1>
            <p>
              Bunker is a separate vault for the Solana you can’t afford to
              lose. Your wallet key can’t open it, so a drainer site or a
              stolen seed phrase alone can’t empty it.
            </p>
            <div className="actions">
              <Link href="/demo" className="button light">
                <Play size={15} fill="currentColor" />
                Watch a drain fail
              </Link>
              <Link href="#how" className="button ghost">
                How it works
              </Link>
            </div>
            <div className="hero-note">
              <BIcon name="bunker-key" size={15} />
              Your wallet gets you in. A separate key gets you out.
            </div>
            <div className="ca-line" aria-label="Contract address coming soon">
              <span className="ca-label">CA</span>
              <span className="ca-typed" aria-hidden="true">
                contract address coming soon...
              </span>
            </div>
          </div>
          <div className="architectural-label">
            <span>00 / EXTERIOR</span>
            <span>PRE-RELEASE · REAL FUNDS NOT ACCEPTED</span>
          </div>
          <div className="hero-status">
            <span className="status-square" />
            SOLANA / PRE-RELEASE
            <span className="status-divider" />
            <Link href="#road">REVIEW PENDING</Link>
          </div>
        </section>
        <section className="principles">
          <span>
            <BIcon name="everyday-wallet" />A wallet signature can’t move it
          </span>
          <span>
            <BIcon name="recovery-kit" />
            Your seed phrase doesn’t open it
          </span>
          <span>
            <BIcon name="lock-changed" />
            Every withdrawal changes the lock
          </span>
          <Link href="#limits">
            Where the protection stops
            <MoveUpRight size={16} />
          </Link>
        </section>
        <section className="check-teaser section surface" data-level="01">
          <Image
            unoptimized
            fill
            sizes="100vw"
            src="/assets/world/01-approach.webp"
            alt=""
          />
          <div>
            <div className="eyebrow">
              <b>01 / SURFACE</b>TEN SECONDS, NOTHING TO CONNECT
            </div>
            <h2>
              What could one signature
              <br />
              take from your wallet?
            </h2>
            <p>
              Paste any Solana address. See everything a single approval could
              move, and any token approvals that are already open.
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
        <section className="intro section" id="how">
          <div className="eyebrow">
            <b>01 / SURFACE</b>A SEPARATE LINE OF DEFENSE
          </div>
          <div className="split-title">
            <h2>
              Keep your wallet.
              <br />
              Rethink what it controls.
            </h2>
            <p>
              Your everyday wallet is for moving. Bunker is for holding. What
              you deposit can only leave with a second key that your wallet
              never has and a website can’t ask it for.
            </p>
          </div>
          <Story />
          <div className="feature-grid">
            {[
              [
                "vault",
                "A drainer gets your wallet, not your vault",
                "Approve the wrong thing and whatever sits in your wallet is exposed. What sits in your Bunker is not.",
              ],
              [
                "bunker-key",
                "A different key to the door",
                "Withdrawals need your Bunker key, which your wallet never holds. Your connected wallet only pays the network fee.",
              ],
              [
                "simulation",
                "It does very little",
                "Hold, withdraw, replace keys. No trading, no approvals, and no calls to any program except Solana’s own system and token programs. Less to get wrong.",
              ],
            ].map(([icon, title, body]) => {
              return (
                <article key={String(title)}>
                  <BIcon name={icon as BunkerIconName} size={28} />
                  <h3>{String(title)}</h3>
                  <p>{String(body)}</p>
                </article>
              );
            })}
          </div>
        </section>
        <Plate
          tall
          src="/assets/world/02-door.webp"
          alt="A tall, narrow doorway recessed into a concrete wall, lit from inside with cold light"
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
              A trading wallet has to sign fast, so its key lives somewhere
              exposed. Sweep what you’re keeping into a Bunker: anything can
              go in from any wallet or terminal, and nothing comes out with
              that wallet’s key.
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
          src="/assets/world/03-threshold.webp"
          alt="A bare concrete corridor seen from inside, the open doorway a slot of grey daylight at the far end"
          level="03 / INSIDE"
          line="Past this point, the keys are yours."
        />
        <section className="section role" data-level="03">
          <div className="eyebrow">
            <b>03 / INSIDE</b>YOUR PART
          </div>
          <div className="split-title">
            <h2>
              Bunker holds the line.
              <br />
              You hold the key.
            </h2>
            <p>
              The program gives nobody an account behind your vault and has
              no reset button. A day key opens it; one recovery kit, made once,
              replaces that key if it is ever lost or stolen. Three habits
              keep it yours.
            </p>
          </div>
          <ol className="role-grid">
            <li>
              <BIcon name="recovery-kit" size={26} />
              <h3>Keep the kit off your everyday device</h3>
              <p>
                Store the recovery kit somewhere your daily browser and wallet
                are not, and keep its password separately.
              </p>
            </li>
            <li>
              <BIcon name="approved-address" size={26} />
              <h3>Never give it to a website</h3>
              <p>
                The kit is opened only in the offline recovery tool. No page,
                including this one, and nobody from Bunker will ever ask for
                it.
              </p>
            </li>
            <li>
              <BIcon name="bunker-key" size={26} />
              <h3>Use your day key on one device</h3>
              <p>
                A second device cannot know what the first has signed. If a
                device is lost or you stop trusting it, the kit installs new
                keys.
              </p>
            </li>
          </ol>
        </section>
        <section className="section limits weather" id="limits">
          <Image
            unoptimized
            fill
            sizes="100vw"
            src="/assets/world/05-weather.webp"
            alt=""
          />
          <div className="eyebrow">
            <b>03 / INSIDE</b>HONEST ABOUT THE EDGES
          </div>
          <h2>
            What it’s built to stop.
            <br />
            What it isn’t.
          </h2>
          <div className="limits-grid">
            <div>
              <h3>Built to stop</h3>
              <ul>
                {stops.map((s) => (
                  <li key={s}>
                    <Check size={16} className="ice" />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3>Does not stop</h3>
              <ul>
                {limits.map((s) => (
                  <li key={s}>
                    <X size={16} />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="limits-note">
            These are design goals supported by local tests, not the result of
            an independent review.{" "}
            <Link href="/security">Read the full threat model.</Link>
          </p>
        </section>
        <section className="truth section" id="road" data-level="04">
          <div className="eyebrow">
            <b>04 / FOUNDATIONS</b>ROAD TO MAINNET
          </div>
          <h2>
            Security is a process.
            <br />
            Not a promise on a website.
          </h2>
          <div className="truth-grid">
            <div>
              <p>
                Real funds stay locked out until five gates are passed. None
                has been passed yet, and none will be marked done without
                evidence you can inspect.
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
              {gates.map(([title, body], i) => (
                <li key={title}>
                  <span className="mono">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <strong>{title}</strong>
                    <span>{body}</span>
                  </div>
                  <b>Pending</b>
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
        <section className="closing section room">
          <Image
            unoptimized
            fill
            sizes="100vw"
            src="/assets/world/04-vault-room-16x9.webp"
            alt=""
          />
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
