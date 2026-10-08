import Link from "next/link";
import { DocumentLayout } from "@/components/bunker/document-layout";
export const metadata = {
  title: "Terms & risks",
  description: "The terms for using the Bunker pre-release and the risks you accept by using it.",
};
export default function Page() {
  return (
    <DocumentLayout
      eyebrow="TERMS & RISKS"
      title="Read this before you rely on anything here."
      description="Plain-language terms for the pre-release. They will be replaced by reviewed terms before real funds are accepted."
    >
      <div className="document-callout">
        <h2>This is experimental software. Do not use real funds.</h2>
        <p>
          Nothing here has completed an independent audit. Mainnet custody is
          disabled. Anything you do with this software or its source code is
          at your own risk.
        </p>
      </div>
      <section>
        <h2>What Bunker is</h2>
        <p>
          Bunker is open-source software: a website, a browser signing
          library and a Solana program. It is not a bank, broker, exchange,
          custodian or wallet provider. Nobody operating this site holds your
          keys, and the program gives nobody a way to move, freeze or return
          your assets. Whoever can upgrade a program can change that, so
          the policy is that the program holding real funds will be deployed
          so that nobody can upgrade it, with proof published.
        </p>
      </section>
      <section>
        <h2>You are responsible for your keys</h2>
        <p>
          A vault is controlled only by its keys: a day key and a recovery
          kit, each with a password. If you lose them, or someone else obtains
          them, the assets can be lost permanently. There is no reset, no support desk that can recover
          them, and no administrator key.
        </p>
      </section>
      <section>
        <h2>Risks you accept</h2>
        <ul>
          <li>
            Bugs in the program, the signing code, the website or their
            dependencies, including ones that cause total loss.
          </li>
          <li>
            Permanent loss of access from a lost recovery kit or a forgotten
            password, and loss of funds from using one day key on more than
            one device.
          </li>
          <li>
            A compromised device, browser, extension, website deployment or
            RPC provider.
          </li>
          <li>
            Solana network failures, fee changes, token issuer actions such as
            freezing, and changes in law.
          </li>
        </ul>
        <p>
          The <Link href="/security">security page</Link> describes these in
          detail. It is part of these terms.
        </p>
      </section>
      <section>
        <h2>No advice, no promises</h2>
        <p>
          Nothing on this site is financial, legal, tax or security advice.
          The wallet check and the demo are informational; the demo is a
          simulation. The software is provided “as is”, without warranty of
          any kind, and to the fullest extent the law allows its authors are
          not liable for any loss arising from its use. The code is released
          under the MIT license, which says the same.
        </p>
      </section>
      <section>
        <h2>Using the site</h2>
        <p>
          Do not use the site to break the law, to attack it or its RPC
          connection, or to test against funds or accounts that are not yours.
          Security research is welcome through{" "}
          <a
            href="https://github.com/plantsweb3/bunker/security/advisories/new"
            target="_blank"
            rel="noreferrer"
          >
            private vulnerability reporting
          </a>
          . You are responsible for whether using this software is lawful
          where you live.
        </p>
      </section>
      <section>
        <h2>Only one official site</h2>
        <p>
          Bunker lives at bunkermode.io and its source at
          github.com/plantsweb3/bunker. Any other site, app, account or token
          using the name is not covered by anything written here unless it is
          linked from this site.
        </p>
      </section>
    </DocumentLayout>
  );
}
