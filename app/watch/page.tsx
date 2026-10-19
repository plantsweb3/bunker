import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { DocumentLayout } from "@/components/bunker/document-layout";
import ExtensionBuild from "@/components/bunker/extension-build";
import store from "@/extension/store.json";

/** The one official listing. Built from the checked-in item ID, the same one /verify shows. */
const storeUrl = store.chromeWebStoreItemId
  ? `https://chromewebstore.google.com/detail/bunker-watch/${store.chromeWebStoreItemId}`
  : null;

export const metadata: Metadata = {
  title: "Bunker Watch",
  description:
    "A browser extension that shows a desktop alert when a withdrawal is announced from your Bunker. Read-only: holds no keys. Public beta.",
};
/** The extension's popup in its four states: file, what the picture shows, and the line under it. */
const shots: [string, string, string][] = [
  [
    "1-all-quiet",
    "The Bunker Watch popup with the heading All quiet, 2 Bunkers watched, and a card for each Bunker showing its SOL balance and that no withdrawal is waiting.",
    "All quiet. Each Bunker you watch, its balance, and when it was last read.",
  ],
  [
    "2-withdrawal-announced",
    "The popup with the heading Withdrawal announced, a cream card with a countdown ring, the amount, the whole destination address, and a button that says What to do now.",
    "A withdrawal was announced. The amount, the whole destination, and the time left to cancel it.",
  ],
  [
    "3-check-a-wallet",
    "The popup's Check a wallet tab showing a wallet's SOL, its token accounts, and two open delegations.",
    "Check any wallet: what one signature could move, and who can already move it.",
  ],
  [
    "4-read-only",
    "The popup's Settings tab with the heading Read-only, holds no keys, the RPC endpoint setting, and a line saying keys held: none.",
    "Settings. It holds no keys and talks to one RPC endpoint.",
  ],
];
export default function Watch() {
  return (
    <DocumentLayout
      eyebrow="BUNKER WATCH · PUBLIC BETA · READ-ONLY"
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
      {storeUrl && (
        <section id="install">
          <h2>Install it</h2>
          <p>
            <a className="button light" href={storeUrl} target="_blank" rel="noreferrer">
              Add to Chrome
            </a>
          </p>
          <p>
            This is the only official listing. Its item ID is{" "}
            <code>{store.chromeWebStoreItemId}</code>; check that it is in the address bar before you install.
          </p>
        </section>
      )}
      <section>
        <h2>What it looks like</h2>
        <ul className="watch-shots">
          {shots.map(([file, alt, caption]) => (
            <li key={file}>
              <figure>
                <Image unoptimized src={`/assets/watch/${file}.webp`} alt={alt} width={1280} height={800} />
                <figcaption>{caption}</figcaption>
              </figure>
            </li>
          ))}
        </ul>
        <p>
          These are the real popup, drawn over made-up readings. Each one is
          labelled SIMULATION.
        </p>
      </section>
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
          <li>Alerts are best effort and can be late or missing. Silence is not proof that nothing happened. If it cannot read the network for five minutes, its badge shows “!” and it tells you once.</li>
          <li>It believes its RPC endpoint. An endpoint that lies can show it anything.</li>
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
          SHA-256. A store repackages what it is given, so an installed copy
          is checked file by file: each file’s own hash is in{" "}
          <a href="/source/extension-manifest.json">extension-manifest.json</a>.
          Fake extensions with this name will appear. The real one matches
          these hashes, and it never asks for a key.
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
