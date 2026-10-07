import Image from "next/image";
import Link from "next/link";
import { Shield, FlaskConical } from "lucide-react";
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
        <span>Hash-based custody. Independent review pending.</span>
        <Link href="/security">Know the limits</Link>
      </div>
      <header className="site-header">
        <Link href="/" aria-label="Bunker home">
          <Mark />
        </Link>
        <nav aria-label="Main navigation">
          <Link href="/demo">Experience Bunker</Link>
          <Link href="/security">Security</Link>
          <Link href="/docs">Documentation</Link>
        </nav>
        <Link className="button compact light" href="/vault">
          Launch app
        </Link>
      </header>
    </>
  );
}
export function Footer() {
  return (
    <footer className="site-footer">
      <div>
        <Link href="/" aria-label="Bunker home">
          <Mark small />
        </Link>
        <p>A quieter place for your Solana.</p>
      </div>
      <div className="footer-links">
        <Link href="/security">Security & limitations</Link>
        <Link href="/verify">Verify the program</Link>
        <a href="https://github.com/plantsweb3/bunker">Source on GitHub</a>
      </div>
      <span className="mono">EXPERIMENTAL · MAINNET CUSTODY LOCKED</span>
    </footer>
  );
}
export function Notice() {
  return (
    <div className="notice">
      <Shield size={18} />
      <span>
        Experimental custody. No completed audit. Use valueless devnet assets
        only.
      </span>
    </div>
  );
}
