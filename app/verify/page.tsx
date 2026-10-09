import { DocumentLayout } from "@/components/bunker/document-layout";
import Verification from "@/components/bunker/verification";
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
            ["02", "Built from", "Commit 2182e5f of the public repository, in the pinned container."],
            ["03", "Executable hash", "a7f39161fd812132e1e43a9a942cbda6b2fcc62bbc8235b0bca72f9bafbf08f7"],
            ["04", "Can be upgraded by", "Ci5cG8d6MvU5ykKkQhN3LHnPN2VCmwZuotRNLqA9SYth, a hardware wallet held by the maintainer."],
            ["05", "Audit", "None. No audit is booked. A bug bounty is open."],
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
          <strong>Not independently verified:</strong> nobody outside the
          project has reproduced the build or confirmed it matches the chain.
          Nobody has audited the program or reviewed the cryptography. The
          site’s own code, the offline tool and the command-line client have
          had no outside review either.
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
      <section>
        <h2>What the site will and will not do</h2>
        <p>
          On mainnet this site, the offline tool and the command-line client
          send transactions to that one program address and to no other; no
          environment setting can change which. The program can be upgraded
          by the key above, so a matching hash describes today’s code, not
          tomorrow’s: check it again before you rely on it.
        </p>
      </section>
    </DocumentLayout>
  );
}
