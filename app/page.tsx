import Image from "next/image";
import Link from "next/link";
import {
  Shield,
  Fingerprint,
  Layers,
  Play,
  MoveUpRight,
  Check,
  LockKeyhole,
  ScanLine,
} from "lucide-react";
import { Header, Footer } from "@/components/bunker/shell";
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
              BUILT FOR WHAT COMES NEXT
            </div>
            <h1>
              Your assets.
              <br />A stronger
              <br />
              <em>place to stay.</em>
            </h1>
            <p>
              A separate home for your Solana.
              <br />
              Separate your assets from your everyday wallet
              <br className="desktop-br" /> with independent, hash-based
              authorization.
            </p>
            <div className="actions">
              <Link href="/vault" className="button light">
                Enter Bunker
              </Link>
              <Link href="/demo" className="button ghost">
                <Play size={15} fill="currentColor" />
                Try the interactive demo
              </Link>
            </div>
            <div className="hero-note">
              <Shield size={14} />
              Your wallet gets you in. A separate key gets you out.
            </div>
          </div>
          <div className="architectural-label">
            <span>01 / THE BUNKER</span>
            <span>STRENGTH THROUGH SIMPLICITY</span>
          </div>
          <div className="hero-status">
            <span className="status-square" />
            SOLANA / PRE-RELEASE
            <span className="status-divider" />
            REVIEW PENDING
          </div>
        </section>
        <section className="principles">
          <span>
            <Layers />
            Program-controlled custody
          </span>
          <span>
            <Fingerprint />
            Independent authorization
          </span>
          <span>
            <ScanLine />
            Source available to inspect
          </span>
          <Link href="/security">
            Unaudited. Deliberately transparent.
            <MoveUpRight size={16} />
          </Link>
        </section>
        <section className="intro section">
          <div className="eyebrow">A SEPARATE LINE OF DEFENSE</div>
          <div className="split-title">
            <h2>
              Keep your wallet.
              <br />
              Rethink what it controls.
            </h2>
            <p>
              Your everyday wallet is for moving.
              <br />
              Bunker is for holding. Deposit into a program-controlled vault,
              then authorize withdrawals with a separate, one-time hash key.
            </p>
          </div>
          <div className="feature-grid">
            {[
              [
                Shield,
                "Built around a smaller surface",
                "Create, deposit, withdraw. No trading, arbitrary calls, or unnecessary permissions.",
              ],
              [
                Fingerprint,
                "A different key to the door",
                "Your connected wallet pays network fees. It does not hold your Bunker withdrawal key.",
              ],
              [
                Layers,
                "Every spend, a fresh authority",
                "A successful withdrawal rotates authorization in the same atomic transaction.",
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
            <div className="eyebrow">UNDERSTAND IT IN ONE MINUTE</div>
            <h2>
              What if your
              <br />
              wallet was compromised?
            </h2>
            <p>
              Move a simulated portfolio into Bunker. Attempt a withdrawal
              without its separate key. See why authorization matters.
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
              <span className="mono">SIMULATION / 01</span>
              <LockKeyhole size={18} />
            </div>
            <div className="flow-row">
              <span className="asset-logo sol">≋</span>
              <div>
                <strong>Everyday wallet</strong>
                <span>Deposit source</span>
              </div>
              <span className="mono">SOL + SPL</span>
            </div>
            <div className="flow-line">
              <span />
              <span className="mono">INDEPENDENT AUTHORITY</span>
              <span />
            </div>
            <div className="flow-row bunker-row">
              <Shield size={26} />
              <div>
                <strong>Your Bunker</strong>
                <span>Hash-authorized withdrawals</span>
              </div>
              <Check size={20} />
            </div>
            <div className="flow-bottom">
              One wallet for today. A separate vault for tomorrow.
            </div>
          </div>
        </section>
        <section className="truth section">
          <div className="eyebrow">TRUST SHOULD BE INSPECTABLE</div>
          <h2>
            Security is a process.
            <br />
            Not a promise on a website.
          </h2>
          <div className="truth-grid">
            <p>
              Bunker is an experimental product built on documented Winternitz
              prior art. It is not audited or approved for real funds, and it
              does not make the Solana network post-quantum.
            </p>
            <div className="truth-status">
              <div>
                <span>Mainnet custody</span>
                <b className="ice">Locked pending review</b>
              </div>
              <div>
                <span>Independent audits</span>
                <b>Not completed</b>
              </div>
              <div>
                <span>Real assets</span>
                <b>Not supported</b>
              </div>
              <Link href="/verify">
                Inspect deployment & source
                <MoveUpRight size={16} />
              </Link>
            </div>
          </div>
        </section>
        <section className="closing section">
          <span className="eyebrow">TAKE A CLOSER LOOK</span>
          <h2>Step inside.</h2>
          <div className="actions">
            <Link href="/vault" className="button light">
              Open the app
            </Link>
            <Link href="/security" className="button ghost">
              Read the threat model
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
