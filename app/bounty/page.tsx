import type { Metadata } from "next";
import Link from "next/link";
import { Header, Footer } from "@/components/bunker/shell";
import { Clip } from "@/components/bunker/loop";
import VaultGauge from "@/components/bunker/vault-gauge";
import { HALL_OF_FAME, REPORT_URL, TIERS } from "@/lib/bounty";
import { getLaunch } from "@/lib/launch-config";

export const metadata: Metadata = {
  title: "Bug bounty",
  description:
    "Break Bunker, report it privately, and get paid from the bounty vault. Public beta on Solana mainnet, not audited.",
};
const steps: [string, string][] = [
  ["Find it", "In the program, the site, the offline tool or the command-line client. All of it is open source."],
  ["Report it privately", "Through GitHub’s private vulnerability report. Nobody else can read it."],
  ["We confirm and fix", "We reproduce it, tell you what we found, and ship the fix."],
  ["You get paid", "From the bounty vault, to the Solana address you give us."],
  ["Public write-up", "After the fix has shipped, with your name on it if you want it there."],
];
const rules = [
  "Proof of concept only. Show that it works; don’t use it.",
  "Never touch funds that aren’t yours.",
  "Test on your own Bunker, with small amounts.",
  "No public disclosure before the fix ships.",
];
export default function Bounty() {
  const { bountyWallet } = getLaunch();
  return (
    <>
      <Header />
      <main className="bounty">
        <section className="bounty-hero">
          <Clip name="padlocks-falling" className="backdrop" />
          <span className="halftone" />
          <div>
            <div className="hero-chips">
              <span className="bm-chip bm-chip--ice">Bug bounty</span>
              <span className="bm-chip bm-chip--cream">Public beta · not audited</span>
            </div>
            <h1 className="bm-big">
              It’s not a bug.
              <span className="bm-accent">It’s a bounty.</span>
            </h1>
            <p>
              Bunker holds real funds on Solana mainnet and nobody has audited
              it. If you can break it, tell us first and get paid for it.
            </p>
            <div className="actions">
              <a className="button light" href={REPORT_URL} target="_blank" rel="noreferrer">
                Report a vulnerability
              </a>
              <Link className="button ghost" href="#tiers">
                What counts
              </Link>
            </div>
          </div>
        </section>

        <section className="section bounty-vault" id="vault">
          <div className="eyebrow">
            <b>01</b>THE BOUNTY VAULT
          </div>
          <div className="bounty-vault-grid">
            <VaultGauge address={bountyWallet}>
              <Clip name="vault-hatch-shut" />
            </VaultGauge>
            <div className="bm-panel bounty-source">
              <div className="bm-panel__head">Where the money comes from</div>
              <p>
                Funded by creator rewards from the Bunker Mode coin ($BUNKER).
                Rewards flow into this wallet and pay for bug bounties and
                Bunker’s development.
              </p>
              <p className="fine">
                The coin is not an investment and doesn’t unlock anything in
                Bunker. Nothing here is financial advice.
              </p>
              <p className="fine">
                The figure is the wallet’s SOL balance, read from the network
                when you opened this page. It is not a promise of any payout.
              </p>
            </div>
          </div>
        </section>

        <section className="section bounty-how" id="report">
          <div className="eyebrow">
            <b>02</b>HOW TO REPORT
          </div>
          <div className="split-title">
            <h2>
              Five steps.
              <br />
              The second one is private.
            </h2>
            <p>
              Say which commit, how to reproduce it, and what it lets someone
              do. Leave out passwords, seed phrases and key files.
            </p>
          </div>
          <ol className="bounty-steps">
            {steps.map(([title, body], i) => (
              <li key={title}>
                <span className="mono">{String(i + 1).padStart(2, "0")}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </li>
            ))}
          </ol>
          <a className="button light" href={REPORT_URL} target="_blank" rel="noreferrer">
            Report privately on GitHub
          </a>
        </section>

        <section className="world-plate bounty-rules">
          <Clip name="key-being-cut" />
          <span className="halftone" />
          <div>
            <span className="mono">03 / THE RULES</span>
            <ul>
              {rules.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="section bounty-tiers" id="tiers">
          <div className="eyebrow">
            <b>04</b>WHAT COUNTS
          </div>
          <div className="split-title">
            <h2>
              Four tiers,
              <br />
              by what it lets someone do.
            </h2>
            <p>
              Payout amounts have not been set yet. They will be written
              here, and nowhere else, when they are.
            </p>
          </div>
          <ol className="tier-grid">
            {TIERS.map((tier) => (
              <li key={tier.name} className={`bm-panel tier-${tier.name.toLowerCase()}`}>
                <div className="bm-panel__head">
                  <span>{tier.name}</span>
                  <span>Payout: {tier.payout}</span>
                </div>
                <h3>{tier.means}</h3>
                <ul>
                  {tier.examples.map((example) => (
                    <li key={example}>{example}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
          <p className="micro">
            Not covered: other people’s wallets and apps, Solana itself, sites
            pretending to be Bunker, tricking a person rather than the
            software, and the coin. Already listed limits are on the{" "}
            <Link href="/security">security page</Link>; a way around one of
            them is still a finding.
          </p>
        </section>

        <section className="section bounty-fame room" id="hall-of-fame">
          <Clip name="crowd-descending-stairs" className="backdrop" />
          <span className="halftone" />
          <div className="eyebrow">
            <b>05</b>HALL OF FAME
          </div>
          <h2>The people who broke it first.</h2>
          {HALL_OF_FAME.length ? (
            <ul className="fame-list">
              {HALL_OF_FAME.map((entry) => (
                <li key={`${entry.name}-${entry.found}`}>
                  <strong>{entry.name}</strong>
                  <span>{entry.found}</span>
                  <span className="mono">{entry.fixedIn}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="fame-empty">Nobody yet. The first name here could be yours.</p>
          )}
        </section>
      </main>
      <Footer />
    </>
  );
}
