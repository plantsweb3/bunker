import { DocumentLayout } from "@/components/bunker/document-layout";
import Verification from "@/components/bunker/verification";
export const metadata = { title: "Verification & review" };
export default function Page() {
  return (
    <DocumentLayout
      eyebrow="VERIFY, THEN TRUST"
      title="Nothing hidden behind a badge."
      description="Deployment observations, source, and the work required before real-fund custody."
    >
      <Verification />
      <section>
        <h2>Source and reproducibility</h2>
        <p>
          The complete web app, small Rust custody program, browser SDK, test
          vectors, and deployment instructions are included in the source
          bundle. Builds use committed npm and Cargo lockfiles. A successful
          local build is not independently verified deployment evidence.
        </p>
        <div className="actions">
          <a
            href="https://github.com/plantsweb3/bunker"
              className="button light"
          >
            Download source
          </a>
          <a
            href="/source/source-manifest.json"
            className="button ghost"
            target="_blank"
            rel="noreferrer"
          >
            Inspect source checksums
          </a>
        </div>
      </section>
      <section>
        <h2>The release gate</h2>
        <div className="review-list">
          {[
            [
              "01",
              "Cryptographic review",
              "Review the upstream primitive, full parameter set, canonical message, and Bunker’s browser port.",
            ],
            [
              "02",
              "Program audit",
              "Independently examine SOL and SPL custody, account validation, proof staging, and atomic authorization changes.",
            ],
            [
              "03",
              "Recovery and signing review",
              "Address multi-device use of a day key, interrupted submissions, the offline tool’s separation from the site, and malicious frontend updates.",
            ],
            [
              "04",
              "Deployment verification",
              "Match reviewed source to the binary, publish hashes and program ID, and decide the upgrade-authority policy.",
            ],
            [
              "05",
              "Operational readiness",
              "Set up an RPC provider, incident contact, security disclosure process, monitoring, and a clearly scoped bounty.",
            ],
          ].map(([number, title, text]) => (
            <div key={number}>
              <span>{number}</span>
              <div>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
              <b>Pending</b>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h2>How a future deployment is verified</h2>
        <p>
          A reviewer should reproduce the reviewed build and compare its
          executable hash to the on-chain program using the{" "}
          <a
            href="https://solana.com/docs/programs/verified-builds"
            target="_blank"
            rel="noreferrer"
          >
            Solana verified-build workflow
          </a>
          . Inspect the program-data account and upgrade authority separately.
          An Explorer link alone establishes neither source equivalence nor
          audit coverage.
        </p>
      </section>
      <section>
        <h2>Current release policy</h2>
        <p>
          The public deployment is read-only on mainnet. No environment switch
          enables mainnet custody. The isolated testing configuration permits
          only a pinned local or devnet network and rejects mainnet writes.
          Accepting real assets requires a reviewed code release and actual
          audit evidence.
        </p>
      </section>
    </DocumentLayout>
  );
}
