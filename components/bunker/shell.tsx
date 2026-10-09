import Image from "next/image";
import Link from "next/link";
import { FlaskConical, Menu } from "lucide-react";
import { NavLinks } from "./nav-links";
export function Mark({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand ${small ? "small" : ""}`}>
      <Image unoptimized src="/brand/bunker-logo-horizontal-stone.svg" alt="Bunker" width={232} height={48} />
    </span>
  );
}
export function Header() {
  return (
    <>
      <div className="network-bar">
        <FlaskConical size={13} />
        <strong>PRE-RELEASE</strong>
        <span>Real funds not accepted yet. Not audited.</span>
        <Link href="/security">Know the limits</Link>
      </div>
      <header className="site-header">
        <Link href="/" aria-label="Bunker home">
          <Mark />
        </Link>
        <nav aria-label="Main navigation">
          <NavLinks />
        </nav>
        <div className="header-actions">
          <Link className="button compact light" href="/vault">
            Launch app
          </Link>
          <details className="mobile-nav">
            <summary aria-label="Menu">
              <Menu size={20} />
            </summary>
            <nav aria-label="Mobile navigation">
              <NavLinks extra={[["/verify", "Verify"]]} />
            </nav>
          </details>
        </div>
      </header>
    </>
  );
}
export function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-brand">
        <Link href="/" aria-label="Bunker home">
          <Mark small />
        </Link>
        <p>Prepare. Don’t panic.</p>
      </div>
      <div className="footer-columns">
        <div>
          <span className="mono">PRODUCT</span>
          <Link href="/demo">Demo</Link>
          <Link href="/check">Check a wallet</Link>
          <Link href="/vault">App preview</Link>
          <Link href="/recovery">Recovery tool</Link>
          <Link href="/docs">How it works</Link>
          <Link href="/integrate">Bunker Mode for trading</Link>
          <Link href="/emergency">My wallet was drained</Link>
        </div>
        <div>
          <span className="mono">TRUST</span>
          <Link href="/security">Security & limitations</Link>
          <Link href="/verify">Verify the program</Link>
          <a href="https://github.com/plantsweb3/bunker">Source on GitHub</a>
          <a href="https://github.com/plantsweb3/bunker/security/advisories/new">
            Report a vulnerability
          </a>
          <Link href="/terms">Terms & risks</Link>
          <Link href="/privacy">Privacy</Link>
        </div>
        <div>
          <span className="mono">FOLLOW</span>
          <a href="https://x.com/BunkerModeIO" target="_blank" rel="noreferrer">
            @BunkerModeIO on X
          </a>
          <a href="https://github.com/plantsweb3/bunker/releases">Releases</a>
        </div>
      </div>
      <span className="mono footer-status">
        EXPERIMENTAL · MAINNET CUSTODY LOCKED · BUNKER ONLY LIVES AT
        BUNKERMODE.IO
      </span>
      <p className="footer-fine">
        Bunker has not been audited. It is new software that will open as a
        public beta; bug bounties are planned and not final yet.
      </p>
    </footer>
  );
}
