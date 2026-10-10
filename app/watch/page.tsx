import type { Metadata } from "next";
import Link from "next/link";
import { DocumentLayout } from "@/components/bunker/document-layout";
import ExtensionBuild from "@/components/bunker/extension-build";

export const metadata: Metadata = {
  title: "Bunker Watch",
  description:
    "A browser extension that shows a desktop alert when a withdrawal is announced from your Bunker. Read-only: holds no keys. Public beta, unaudited.",
};
export default function Watch() {
  return (
    <DocumentLayout
      eyebrow="BUNKER WATCH · PUBLIC BETA · UNAUDITED"
      title="Know when a withdrawal is announced."
      description="A browser extension that watches your Bunker and tells you when something changes. It reads. It cannot move anything."
    >
      <div className="document-callout">
        <h2>Read-only. Holds no keys.</h2>
        <p>
          Bunker Watch never sees a day key, a recovery kit or a password,
          and it has no way to send a transaction. Bunker never asks for
          your recovery kit or its password, here or anywhere else.
        </p>
      </div>
      <section>
        <h2>What it does</h2>
        <ul>
          <li>
            You paste the address of a Bunker. It checks that the address is
            a Bunker of the published program, and watches up to five.
          </li>
          <li>
            Once a minute it reads each one and compares it with what it saw
            the minute before.
          </li>
          <li>
            When a withdrawal is announced you get a desktop notification, the
            toolbar badge shows the hours left, and the popup shows the
            amount, where it is going, whether that is one of your trusted
            addresses, and a countdown.
          </li>
          <li>
            It also tells you when SOL arrives, when a withdrawal leaves, and
            when a Bunker’s keys are replaced.
          </li>
          <li>
            It can run the same <Link href="/check">wallet check</Link> as
            this site, for any address.
          </li>
        </ul>
      </section>
      <section>
        <h2>Why it matters</h2>
        <p>
          A withdrawal to an address you did not list as trusted waits before
          it can leave, and you can cancel it while it waits. That only helps
          if you find out in time. Bunker Watch does the finding out on your
          own computer, with no server of ours in between.
        </p>
        <p>
          If an alert is not you, the extension does not act. It sends you to{" "}
          <Link href="/emergency">what to do now</Link>, where your cancel
          file or your recovery kit stops the withdrawal.
        </p>
      </section>
      <section>
        <h2>What it does not do</h2>
        <ul>
          <li>It does not withdraw, deposit, cancel or recover. Those stay on this site, the offline tool and the command-line client.</li>
          <li>It runs only while your browser is running. A closed laptop sees nothing until it is opened again.</li>
          <li>Alerts are best effort and can be late or missing. Silence is not proof that nothing happened.</li>
          <li>It reports SOL arriving, not token deposits.</li>
          <li>It protects nothing by itself. Bunker protects the withdrawal path, not the chain, and this only tells you what happened on that path.</li>
        </ul>
      </section>
      <section>
        <h2>What it is allowed to do in your browser</h2>
        <ul>
          <li>Remember the addresses you watch and their last public state.</li>
          <li>Wake up once a minute.</li>
          <li>Show notifications.</li>
          <li>
            Talk to one Solana RPC endpoint: the public mainnet one, or one you
            set, which your browser asks you to allow.
          </li>
        </ul>
        <p>
          It cannot read or change any web page, and it loads no code from
          the network. An endpoint that is not Solana mainnet is refused.
        </p>
      </section>
      <section id="build">
        <h2>The build this site serves</h2>
        <ExtensionBuild />
        <p>
          The zip is built from the <a href="https://github.com/plantsweb3/bunker/tree/main/extension">public source</a>{" "}
          and comes out the same, byte for byte, on any machine:{" "}
          <code>npm ci && npm run extension:build</code>, then compare the
          SHA-256. Fake extensions with this name will appear. The real one
          is the file with this hash, and it never asks for a key.
        </p>
      </section>
      <section>
        <h2>Load it by hand</h2>
        <ol>
          <li>Download the zip above and unzip it into a folder you will keep.</li>
          <li>
            Open <code>chrome://extensions</code> in Chrome or another
            Chromium browser and turn on Developer mode.
          </li>
          <li>Choose “Load unpacked” and pick that folder.</li>
          <li>Open Bunker Watch from the toolbar and paste your Bunker’s address.</li>
        </ol>
        <p>
          A hand-loaded extension does not update itself. Check this page for
          a new version, and compare the hash each time.
        </p>
      </section>
    </DocumentLayout>
  );
}
