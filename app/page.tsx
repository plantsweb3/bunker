import Image from "next/image";
import Link from "next/link";
import {
  Shield,
  Fingerprint,
  Layers,
  Play,
  MoveUpRight,
  Check,
  X,
  LockKeyhole,
  HardDrive,
  Globe,
  KeyRound,
} from "lucide-react";
import { Header, Footer } from "@/components/bunker/shell";
const REPO = "https://github.com/plantsweb3/bunker";
const X_URL = "https://x.com/BunkerModeIO";
const stops = [
  "A drainer site that tricks your wallet into signing. A wallet signature alone cannot move what is in the vault.",
  "A stolen or leaked seed phrase. Your seed phrase does not produce the Bunker key.",
  "A reused authorization. Every successful withdrawal replaces the key in the same transaction.",
];
const limits = [
  "Malware on the device where you open your recovery kit. It can copy the kit and record the password.",
  "A fake Bunker site. Anyone who gets your recovery kit and its password has your Bunker key.",
  "A lost recovery kit or password. There is no reset and no administrator.",
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
      signature at all. The two work together.
    </>,
  ],
  [
    "What happens if I lose my recovery kit or its password?",
    <>
      The assets in that vault cannot be recovered. Nobody, including the
      people who build Bunker, can reset it. That is the cost of having no
      back door, and it is why the app makes you prove the kit is saved before
      a vault is created.
    </>,
  ],
  [
    "What if Bunker goes away?",
    <>
      A vault is controlled by an on-chain program with no administrator, not
      by this website. The code that builds a withdrawal is{" "}
      <a href={REPO} target="_blank" rel="noreferrer">
        public
      </a>
      . A recovery tool that works without this site is on the list before
      mainnet.
    </>,
  ],
  [
    "What does it cost?",
    <>
      The pre-release is free to explore. The custody program has no fee and no
      administrator key. You pay ordinary Solana network fees and account rent
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
      <main>
        <section className="hero">
          <Image
            fill
            priority
            sizes="100vw"
            className="hero-image"
            src="/assets/bunker-hero.png"
            alt="A monumental concrete bunker set into a basalt landscape, with a narrow illuminated entrance"
          />
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
              <Shield size={14} />
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
            <span>01 / THE BUNKER</span>
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
            <Layers />A wallet signature can’t move it
          </span>
          <span>
            <Fingerprint />
            Your seed phrase doesn’t open it
          </span>
          <span>
            <KeyRound />
            Every withdrawal changes the lock
          </span>
          <Link href="#limits">
            Where the protection stops
            <MoveUpRight size={16} />
          </Link>
        </section>
        <section className="intro section" id="how">
          <div className="eyebrow">A SEPARATE LINE OF DEFENSE</div>
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
          <div className="feature-grid">
            {[
              [
                Shield,
                "A drainer gets your wallet, not your vault",
                "Approve the wrong thing and whatever sits in your wallet is exposed. What sits in your Bunker is not.",
              ],
              [
                Fingerprint,
                "A different key to the door",
                "Withdrawals need the Bunker key from your recovery kit. Your connected wallet only pays the network fee.",
              ],
              [
                Layers,
                "It only does three things",
                "Create, deposit, withdraw. No trading, no approvals, no calls to other programs. Less to get wrong.",
              ],
            ].map(([Icon, title, body]) => {
              const I = Icon as typeof Shield;
              return (
                <article key={String(title)}>
                  <I size={25} />
                  <h3>{String(title)}</h3>
                  <p>{String(body)}</p>
                </article>
              );
            })}
          </div>
        </section>
        <section className="demo-teaser section">
          <div>
            <div className="eyebrow">SEE IT IN ONE MINUTE</div>
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
              <Shield size={26} />
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
        <section className="section role">
          <div className="eyebrow">YOUR PART</div>
          <div className="split-title">
            <h2>
              Bunker holds the line.
              <br />
              You hold the key.
            </h2>
            <p>
              There is no company account behind your vault and no reset
              button. The Bunker key lives in an encrypted recovery kit that
              only you have. Three habits keep it yours.
            </p>
          </div>
          <ol className="role-grid">
            <li>
              <HardDrive size={22} />
              <h3>Keep the kit off your everyday device</h3>
              <p>
                Store the recovery kit somewhere your daily browser and wallet
                are not, and keep its password separately.
              </p>
            </li>
            <li>
              <Globe size={22} />
              <h3>Open it in one place only</h3>
              <p>
                The kit is only ever used at bunkermode.io. Nobody from Bunker
                will ask for it by message, email or form.
              </p>
            </li>
            <li>
              <KeyRound size={22} />
              <h3>Treat it as the only copy of the key</h3>
              <p>
                If the kit or its password is lost, the vault cannot be opened
                by anyone. Keep the newest kit after every withdrawal.
              </p>
            </li>
          </ol>
        </section>
        <section className="section limits" id="limits">
          <div className="eyebrow">HONEST ABOUT THE EDGES</div>
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
        <section className="truth section" id="road">
          <div className="eyebrow">ROAD TO MAINNET</div>
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
          <div className="eyebrow">QUESTIONS</div>
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
        <section className="closing section">
          <span className="eyebrow">PREPARE. DON’T PANIC.</span>
          <h2>Step inside.</h2>
          <div className="actions">
            <Link href="/demo" className="button light">
              Run the simulation
            </Link>
            <Link href="/vault" className="button ghost">
              Preview the app
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
