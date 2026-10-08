// PROTOTYPE of a new landing page: Bunker as a civil-defence manual. Static,
// no client code; the wallet check is a plain form that opens /check.
import type { Metadata } from "next";
import Link from "next/link";
import "./manual.css";

export const metadata: Metadata = {
  title: "Bunker — Prepare. Don’t panic.",
  robots: { index: false },
};

const INK = "#17140f";
const SIGNAL = "#e2470a";
const BLUE = "#1d3b5c";

function Mark() {
  return (
    <svg viewBox="0 0 30 30" aria-hidden="true">
      <rect x="1.5" y="1.5" width="27" height="27" fill="none" stroke={INK} strokeWidth="3" />
      <path d="M8 23V12a7 7 0 0 1 14 0v11" fill="none" stroke={INK} strokeWidth="3" />
      <rect x="13.5" y="15" width="3" height="8" fill={SIGNAL} />
    </svg>
  );
}

/** Fig. 1: the wallet on the surface, the Bunker below it, in cross-section. */
function CrossSection() {
  return (
    <svg viewBox="0 0 560 500" role="img" aria-label="Cross-section diagram. An everyday wallet stands on the surface, exposed to signatures, approvals and a leaked seed phrase. Below ground, behind a thick wall, is the Bunker. The wallet key reaches only the surface. A separate Bunker key opens the door below.">
      <defs>
        <pattern id="earth" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="10" stroke={INK} strokeWidth="1.3" />
        </pattern>
        <pattern id="wall" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
          <line x1="0" y1="0" x2="0" y2="7" stroke={INK} strokeWidth="2.2" />
        </pattern>
        <marker id="tip" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0L10 5L0 10z" fill={SIGNAL} />
        </marker>
        <marker id="dot" viewBox="0 0 8 8" refX="4" refY="4" markerWidth="6" markerHeight="6">
          <circle cx="4" cy="4" r="3.2" fill={INK} />
        </marker>
      </defs>
      {/* Earth, with the Bunker cut out of it */}
      <rect x="0" y="196" width="560" height="304" fill="url(#earth)" opacity="0.5" />
      <line x1="0" y1="196" x2="560" y2="196" stroke={INK} strokeWidth="3.5" />
      {/* Incoming: what reaches a wallet */}
      {[70, 120, 170, 220].map((x, i) => (
        <line key={x} x1={x + 34} y1={18 + i * 6} x2={x + 6} y2={104 - i * 2} stroke={SIGNAL} strokeWidth="2.5" markerEnd="url(#tip)" />
      ))}
      <text x="282" y="34" fontSize="15" fill={SIGNAL}>ONE BAD SIGNATURE</text>
      <text x="282" y="53" fontSize="15" fill={SIGNAL}>A LEAKED SEED PHRASE</text>
      <text x="282" y="72" fontSize="15" fill={SIGNAL}>AN OLD APPROVAL</text>
      {/* The everyday wallet: a hut on the surface */}
      <path d="M62 196V138l74-36 74 36v58z" fill="#ece4d2" stroke={INK} strokeWidth="3" />
      <path d="M48 144l88-44 88 44" fill="none" stroke={INK} strokeWidth="3" />
      <rect x="120" y="156" width="32" height="40" fill="none" stroke={INK} strokeWidth="2.5" />
      <text x="136" y="226" fontSize="15" textAnchor="middle" fill={INK}>A · EVERYDAY WALLET</text>
      {/* Shaft */}
      <rect x="352" y="196" width="56" height="74" fill="#ece4d2" stroke={INK} strokeWidth="3" />
      <rect x="338" y="182" width="84" height="16" fill={INK} />
      {/* The Bunker: thick wall, clear interior */}
      <rect x="196" y="262" width="330" height="200" fill="#ece4d2" stroke={INK} strokeWidth="3.5" />
      <rect x="196" y="262" width="330" height="200" fill="url(#wall)" />
      <rect x="224" y="290" width="274" height="144" fill="#ece4d2" stroke={INK} strokeWidth="3" />
      {/* Door at the foot of the shaft */}
      <rect x="352" y="262" width="56" height="28" fill="#ece4d2" stroke="none" />
      <rect x="350" y="268" width="60" height="16" fill={BLUE} stroke={INK} strokeWidth="2.5" />
      <circle cx="380" cy="276" r="5" fill="#ece4d2" stroke={INK} strokeWidth="2" />
      {/* Contents */}
      {[0, 1, 2].map((r) =>
        [0, 1, 2, 3].slice(0, 4 - r).map((c) => (
          <rect key={`${r}-${c}`} x={240 + c * 34 + r * 17} y={400 - r * 28} width="30" height="24" fill="none" stroke={INK} strokeWidth="2.2" />
        )),
      )}
      <text x="438" y="336" fontSize="15" textAnchor="middle" fill={INK}>B · BUNKER</text>
      <text x="438" y="356" fontSize="12.5" textAnchor="middle" className="note" fill={INK}>what you</text>
      <text x="438" y="372" fontSize="12.5" textAnchor="middle" className="note" fill={INK}>can’t lose</text>
      {/* Callouts */}
      <path d="M210 168H228" fill="none" stroke={INK} strokeWidth="1.8" markerStart="url(#dot)" />
      <text x="234" y="164" fontSize="13" className="note" fill={INK}>wallet key</text>
      <text x="234" y="180" fontSize="13" className="note" fill={INK}>stops here.</text>
      <path d="M410 276H478V182" fill="none" stroke={INK} strokeWidth="1.8" markerStart="url(#dot)" />
      <text x="434" y="156" fontSize="13" className="note" fill={INK}>Bunker key:</text>
      <text x="434" y="172" fontSize="13" className="note" fill={INK}>a different key.</text>
      <path d="M206 452H150V482" fill="none" stroke={INK} strokeWidth="1.8" markerStart="url(#dot)" />
      <text x="14" y="476" fontSize="13" className="note" fill={INK}>wall: a public</text>
      <text x="14" y="492" fontSize="13" className="note" fill={INK}>program.</text>
    </svg>
  );
}

const Kit = () => (
  <svg viewBox="0 0 250 110" aria-hidden="true">
    <rect x="18" y="34" width="120" height="62" fill="none" stroke={INK} strokeWidth="3" />
    <path d="M56 34V22h44v12" fill="none" stroke={INK} strokeWidth="3" />
    <line x1="18" y1="58" x2="138" y2="58" stroke={INK} strokeWidth="2" />
    <rect x="68" y="50" width="20" height="16" fill={SIGNAL} stroke={INK} strokeWidth="2" />
    {[0, 1, 2].map((i) => (
      <g key={i} transform={`translate(${160 + i * 26} ${30 + i * 8})`}>
        <path d="M0 0h18l8 8v38H0z" fill="#ece4d2" stroke={INK} strokeWidth="2.4" />
        <path d="M18 0v8h8" fill="none" stroke={INK} strokeWidth="2" />
      </g>
    ))}
  </svg>
);
const MoveIn = () => (
  <svg viewBox="0 0 250 110" aria-hidden="true">
    <path d="M14 96V58l34-18 34 18v38z" fill="none" stroke={INK} strokeWidth="3" />
    <path d="M96 68h62" stroke={SIGNAL} strokeWidth="4" />
    <path d="M150 56l16 12-16 12" fill="none" stroke={SIGNAL} strokeWidth="4" />
    <rect x="178" y="26" width="58" height="70" fill="none" stroke={INK} strokeWidth="5" />
    <circle cx="207" cy="61" r="13" fill="none" stroke={INK} strokeWidth="3" />
    <path d="M207 48v26M194 61h26" stroke={INK} strokeWidth="2.5" />
  </svg>
);
const Wait = () => (
  <svg viewBox="0 0 250 110" aria-hidden="true">
    <circle cx="60" cy="60" r="40" fill="none" stroke={INK} strokeWidth="3" />
    <path d="M60 32v28l20 12" fill="none" stroke={INK} strokeWidth="3.5" />
    <path d="M60 20v6M60 94v6M20 60h6M94 60h6" stroke={INK} strokeWidth="2.5" />
    <rect x="132" y="30" width="104" height="60" fill="none" stroke={INK} strokeWidth="3" />
    <path d="M132 30l104 60M236 30l-104 60" stroke={SIGNAL} strokeWidth="3.5" />
    <text x="184" y="22" fontSize="13" textAnchor="middle" fill={INK} style={{ fontFamily: "Barlow Condensed, Arial Narrow, sans-serif", fontWeight: 700, letterSpacing: "0.14em" }}>
      CANCEL
    </text>
  </svg>
);

export default function Manual() {
  return (
    <div className="fm">
      <header className="fm-head">
        <div className="fm-sheet">
          <Link href="/manual" className="fm-mark" aria-label="Bunker">
            <Mark />
            BUNKER
          </Link>
          <nav className="fm-nav" aria-label="Main">
            <Link href="/check">Check a wallet</Link>
            <Link href="/docs">Manual</Link>
            <Link href="/security">Limits</Link>
            <Link href="/demo">Run the drill</Link>
          </nav>
        </div>
      </header>
      <div className="fm-docline">
        <div className="fm-sheet">
          <span>Publication B-3 · Wallet defence for Solana</span>
          <span>Pre-release · not for real funds · unaudited</span>
          <span>CA: contract address coming soon...</span>
        </div>
      </div>

      <main>
        <div className="fm-sheet">
          <section className="fm-cover">
            <div>
              <p className="fm-kicker">Prepare. Don’t panic.</p>
              <h1>
                One bad signature should not cost you <em>everything.</em>
              </h1>
              <p className="fm-lede">
                Your wallet signs things all day. Sooner or later it signs the wrong one. Bunker is a
                separate vault for what you can’t afford to lose, built so that your wallet’s key
                cannot open it.
              </p>
              <div className="fm-actions">
                <Link className="fm-btn" href="/demo">
                  Run the drill
                </Link>
                <Link className="fm-btn plain" href="/docs">
                  Read the manual
                </Link>
              </div>
            </div>
            <figure className="fm-fig">
              <CrossSection />
              <figcaption>
                <b>FIG. 1</b>
                <span>
                  What reaches a wallet does not reach the Bunker. The wall is a public program; the
                  door takes a key the wallet never holds.
                </span>
              </figcaption>
            </figure>
            <div className="fm-stamp" aria-hidden="true">
              Pre-release
              <small>test networks only</small>
            </div>
          </section>
        </div>

        <div className="fm-band">
          <p>
            <span>Notice: this is a pre-release. It does not hold real funds and has not been audited.</span>
          </p>
        </div>

        <div className="fm-sheet">
          <section className="fm-sec">
            <div className="fm-sec-head">
              <div className="fm-num" aria-hidden="true">01</div>
              <div>
                <span className="fm-label">Assess</span>
                <h2>Know what one signature can take.</h2>
                <p>Paste any Solana address. Nothing to connect, nothing to sign. It reads public balances and open approvals.</p>
              </div>
            </div>
            <form className="fm-form" action="/check" method="get">
              <div className="fm-form-top">
                <span>Form B-3/A · Exposure assessment</span>
                <span>Read-only · mainnet</span>
              </div>
              <div className="fm-form-body">
                <label className="fm-field">
                  <span>Wallet address</span>
                  <input name="a" autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="type or paste here" required />
                </label>
                <button type="submit">Assess</button>
              </div>
              <div className="fm-form-foot">The address is sent to a Solana RPC provider to be read. This site does not store it.</div>
            </form>
          </section>

          <section className="fm-sec">
            <div className="fm-sec-head">
              <div className="fm-num" aria-hidden="true">02</div>
              <div>
                <span className="fm-label">Procedure</span>
                <h2>Three steps. Done once.</h2>
                <p>You keep your wallet. You change what it is able to lose.</p>
              </div>
            </div>
            <div className="fm-steps">
              <div className="fm-step">
                <Kit />
                <h3>Build it offline</h3>
                <p>A tool you download makes your keys away from any website: a recovery kit to put in a drawer, a day key to use, and a cancel file to keep close.</p>
              </div>
              <div className="fm-step">
                <MoveIn />
                <h3>Move in</h3>
                <p>Send SOL and tokens to your Bunker from any wallet. Leave out only what you are prepared to lose this week.</p>
              </div>
              <div className="fm-step">
                <Wait />
                <h3>Leave on your terms</h3>
                <p>Withdrawals to wallets you listed in advance arrive at once. Anything else waits a day, and during that day you can cancel it.</p>
              </div>
            </div>
          </section>

          <section className="fm-sec">
            <div className="fm-sec-head">
              <div className="fm-num" aria-hidden="true">03</div>
              <div>
                <span className="fm-label">Equipment</span>
                <h2>Three keys. Three jobs.</h2>
                <p>Losing one of them is survivable. That is the point of having three.</p>
              </div>
            </div>
            <table className="fm-table">
              <thead>
                <tr>
                  <th scope="col">Key</th>
                  <th scope="col">Where it lives</th>
                  <th scope="col">What it can do</th>
                  <th scope="col">If a thief gets it</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Wallet key</th>
                  <td data-h="Lives">Your everyday wallet</td>
                  <td data-h="Does">Pays fees. Deposits.</td>
                  <td data-h="If stolen">Nothing leaves the Bunker.</td>
                </tr>
                <tr>
                  <th scope="row">Day key</th>
                  <td data-h="Lives">A file you open to withdraw</td>
                  <td data-h="Does">Announces withdrawals.</td>
                  <td data-h="If stolen">They can pay your own listed wallets. Anything else waits, and you cancel it.</td>
                </tr>
                <tr>
                  <th scope="row">Recovery kit</th>
                  <td data-h="Lives">Offline. A drawer, not a device.</td>
                  <td data-h="Does">Replaces every key.</td>
                  <td data-h="If stolen" className="bad">Everything. Guard this one.</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section className="fm-sec">
            <div className="fm-sec-head">
              <div className="fm-num" aria-hidden="true">04</div>
              <div>
                <span className="fm-label">Emergency</span>
                <h2>If a withdrawal appears that you did not make.</h2>
              </div>
            </div>
            <div className="fm-placard">
              <div className="fm-placard-sign">
                <span className="fm-label">In case of emergency</span>
                <strong>Upload your cancel file.</strong>
              </div>
              <ol>
                <li>Open the recovery page on any device. No wallet needs to be trusted.</li>
                <li>Choose the cancel file you saved when you built your Bunker.</li>
                <li>The withdrawal is cancelled and the stolen day key stops working. Nothing has left.</li>
                <li>Later, fetch your recovery kit and make a new day key.</li>
              </ol>
            </div>
          </section>

          <section className="fm-sec">
            <div className="fm-sec-head">
              <div className="fm-num" aria-hidden="true">05</div>
              <div>
                <span className="fm-label">Limits</span>
                <h2>What it stops. What it does not.</h2>
                <p>These are design goals backed by tests. They are not the result of an independent review.</p>
              </div>
            </div>
            <div className="fm-two">
              <div className="yes">
                <h3>Built to stop</h3>
                <ul>
                  <li>A drainer site that tricks your wallet into signing.</li>
                  <li>A stolen or leaked seed phrase.</li>
                  <li>A replayed authorization: each one works once.</li>
                  <li>A stolen day key, while the wait is on.</li>
                </ul>
              </div>
              <div className="no">
                <h3>Does not stop</h3>
                <ul>
                  <li>Malware on the device where you open your day key, if your Bunker has no waiting period.</li>
                  <li>A thief paying a wallet you listed as trusted. Choose those with care.</li>
                  <li>A lost recovery kit. Nobody can reset it, us included.</li>
                  <li>A token whose issuer can freeze or move it.</li>
                </ul>
              </div>
            </div>
            <div className="fm-actions">
              <Link className="fm-btn plain" href="/security">
                Read the full limits
              </Link>
            </div>
          </section>
        </div>
      </main>

      <footer className="fm-colophon">
        <div className="fm-sheet">
          <div>
            <b>Bunker · Publication B-3</b>
            Prepare. Don’t panic. Pre-release software for inspection and valueless testing. Real funds
            are not accepted. Nothing here is financial advice.
          </div>
          <div>
            <b>Read</b>
            <Link href="/docs">The manual</Link>
            <Link href="/security">Limits</Link>
            <Link href="/emergency">If your wallet was drained</Link>
            <Link href="/verify">Review status</Link>
          </div>
          <div>
            <b>Inspect</b>
            <a href="https://github.com/plantsweb3/bunker">Source code</a>
            <a href="https://x.com/BunkerModeIO">@BunkerModeIO</a>
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
