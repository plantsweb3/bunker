import { AUDIT } from "@/lib/audit";
import Link from "next/link";
import { DocumentLayout } from "@/components/bunker/document-layout";
import Verification from "@/components/bunker/verification";
import ExtensionBuild from "@/components/bunker/extension-build";
export const metadata = { title: "Verification & review" };
export default function Page() {
  return (
    <DocumentLayout
      eyebrow="VERIFY, THEN TRUST"
      title="Nothing hidden behind a badge."
      description="The program on mainnet, the source it was built from, and who can change it."
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
        <h2>The program on mainnet</h2>
        <div className="review-list">
          {[
            ["01", "Program", "DGXACBwbUqRKRVR1TQojZBoRuV2TZJ8wVnQSuLKm2nJJ"],
            ["02", "Built from", "Commit 9bb0856 of the public repository, in the pinned container. Live since the upgrade of 19 October 2026: the program code of commit f6a37ce plus one change, which refuses a withdrawal announcement the vault cannot pay."],
            ["03", "Executable hash", "161e6b4caac746dc35115910c2b4d50fe319b97d5a3a4ec39f9b6350adf14518"],
            ["04", "Upgrade authority", "None. It was renounced on 19 October 2026, so the program can never be changed."],
            ["05", "Audit", `Done, by ${AUDIT.by}, published ${AUDIT.published}: the program and its signature verifier at commit ${AUDIT.commit}. ${AUDIT.summary} The one code fix is the change in commit 9bb0856 above. A bug bounty is open.`],
          ].map(([number, title, text]) => (
            <div key={number}>
              <span>{number}</span>
              <div>
                <h3>{title}</h3>
                <p className="address">{text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h2>What has been checked, and by whom</h2>
        <p>
          <strong>Checked by the project, not by anyone independent:</strong>{" "}
          the executable hash above was produced three times from that
          commit, twice by the public CI and once on a separate machine, and
          it equals the hash of the program read back from mainnet. The
          program’s test suite passes against that exact binary.
        </p>
        <p>
          <strong>Checked by a public service:</strong> before the upgrade
          key was renounced, it recorded on chain which commit the program was
          built from, and{" "}
          <a
            href="https://verify.osec.io/status/DGXACBwbUqRKRVR1TQojZBoRuV2TZJ8wVnQSuLKm2nJJ"
            target="_blank"
            rel="noreferrer"
          >
            the public verified-builds service
          </a>{" "}
          rebuilt that commit and got the program that is on chain. That
          shows the code on chain is the code in the repository. It does not
          show the code is correct.
        </p>
        <p>
          <strong>Independently audited:</strong> the program and its
          signature verifier, by {AUDIT.by}.{" "}
          <a href={AUDIT.url} target="_blank" rel="noreferrer">Read the report</a>.
          The site’s own code, the offline tool and the command-line client
          were not part of that audit and have had no outside review.
        </p>
      </section>
      <section>
        <h2>Check it yourself</h2>
        <p>
          Reproduce the build and compare its executable hash to the program
          on chain using the{" "}
          <a
            href="https://solana.com/docs/programs/verified-builds"
            target="_blank"
            rel="noreferrer"
          >
            Solana verified-build workflow
          </a>
          : <code>solana-verify build --library-name bunker3</code> at that
          commit, then <code>solana-verify get-program-hash</code> for the
          program address. Read the program-data account for the upgrade
          authority. An Explorer link alone establishes neither source
          equivalence nor audit coverage.
        </p>
      </section>
      <section id="extension">
        <h2>The browser extension</h2>
        <p>
          <Link href="/watch">Bunker Watch</Link> is read-only and holds no
          keys. This is the build this site serves. Compare the hash before
          you load it, and treat any store listing not named here as someone
          else’s.
        </p>
        <ExtensionBuild />
      </section>
      <section>
        <h2>What the site will and will not do</h2>
        <p>
          On mainnet this site, the offline tool and the command-line client
          send transactions to that one program address and to no other; no
          environment setting can change which. The program has no upgrade
          authority, so a matching hash describes it for good.
        </p>
      </section>
    </DocumentLayout>
  );
}
