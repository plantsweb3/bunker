import Link from "next/link";
import { DocumentLayout } from "@/components/bunker/document-layout";
export const metadata = { title: "How Bunker works" };
export default function Page() {
  return (
    <DocumentLayout
      eyebrow="THE OPERATOR’S MANUAL"
      title="A small vault. An explicit process."
      description="What each key does, what leaves your device, and what happens at every step. Draft protocol; real funds are not accepted yet."
    >
      <section>
        <h2>Three keys, three jobs</h2>
        <ul>
          <li>
            <strong>Your wallet</strong> pays network fees and makes deposits.
            It has no authority over the vault. Connecting it reads your
            public address and grants nothing.
          </li>
          <li>
            <strong>Your day key</strong> announces withdrawals. It is a file
            protected by a password, and on a supported device you can unlock
            it with a passkey instead.
          </li>
          <li>
            <strong>Your recovery kit</strong> is made once and never changes.
            It replaces a lost or stolen day key and cancels a withdrawal that
            is still waiting. It never moves assets, and it is never opened on
            this website.
          </li>
        </ul>
      </section>
      <section>
        <h2>1. Build a Bunker, offline</h2>
        <p>
          Download the recovery tool from the{" "}
          <Link href="/recovery">recovery page</Link>. It is a single file
          whose own security policy stops it making network connections, and it
          only runs from the copy you saved, never from the website. In it
          you choose two passwords, one for the recovery kit and a different
          one for the day key, and whether to add a waiting period. It saves
          three files: the recovery kit, your first day key, and a creation
          request. Only the creation request, which holds public commitments
          and nothing secret, is uploaded to the site to create the vault
          on-chain. The recovery kit’s password is never typed into a
          website.
        </p>
        <p>
          Each key file is encrypted with AES-256-GCM under a key derived
          from its password with scrypt, a function chosen because each
          guess at the password costs an attacker a large amount of memory.
          There is no reset, so the recovery kit’s password should be five or
          more unrelated words. The Bunker’s address is computed from its keys and its
          waiting period, so nobody else can create it with different ones. The tool makes you re-open the saved kit before it
          continues.
        </p>
      </section>
      <section>
        <h2>2. The waiting period is your choice</h2>
        <p>
          Off by default: a withdrawal leaves as soon as you approve it. If
          you turn it on, every withdrawal from that Bunker waits the time you
          picked, from one hour to seven days, and you can cancel it during
          the wait. It is fixed for that Bunker.
        </p>
        <p>
          What it buys: without one, anyone who gets your day key and its
          password can withdraw immediately. With one, you have that long to
          cancel.
        </p>
      </section>
      <section>
        <h2>3. Deposit from anywhere</h2>
        <p>
          A Bunker has an ordinary Solana address. SOL can be sent to it from
          any wallet, exchange or trading terminal. Classic SPL tokens are
          deposited through the app, which creates the right token account.
          Token-2022 is not supported.
        </p>
      </section>
      <section>
        <h2>4. Withdraw</h2>
        <p>
          Open your Bunker with the day key. Enter the asset, amount and
          recipient, review them, and approve three transactions: two upload a
          1,088-byte one-time signature, and the third verifies it. The
          signature fixes the exact asset, amount and destination, and names
          the next one-time key, so the key you used is retired in the same
          step and the same signature can never be used again.
        </p>
        <p>
          With no waiting period, that third transaction also sends the
          assets. With one, it records the withdrawal and starts the clock;
          when the wait ends, anyone can submit the release, and it can only
          go to the address you signed.
        </p>
      </section>
      <section>
        <h2>5. Cancel, or replace a key</h2>
        <p>
          In the offline tool, open your recovery kit and enter your Bunker’s
          current key generation. It saves a recovery packet and a new day
          key. Upload the packet on the recovery page. It installs new keys,
          retires every earlier day key, and cancels a withdrawal that has not
          left. For a given Bunker and key generation the packet is always the
          same bytes, so making or submitting it twice is harmless.
        </p>
        <p>
          The same step is the answer whenever something is in doubt: a lost
          day key, a device you no longer trust, or a withdrawal that was
          signed but never reached the network.
        </p>
      </section>
      <section>
        <h2>6. Seal</h2>
        <p>
          Sealing removes the day key from the browser tab. The Bunker on-chain
          is unchanged, and opens again only with the day key.
        </p>
      </section>
      <section>
        <h2>What to keep in mind</h2>
        <ul>
          <li>
            Use one day key on one device. A second device cannot know what
            the first has signed.
          </li>
          <li>
            Keep the recovery kit off the device you browse with. Whoever
            holds it and its password controls the Bunker.
          </li>
          <li>
            Lose both the recovery kit and the day key and nobody can open the
            vault.
          </li>
        </ul>
        <p>
          <Link href="/security">What Bunker does and does not protect.</Link>
        </p>
      </section>
      <section>
        <h2>Run and review the implementation</h2>
        <p>
          The repository holds the program, the client, the offline tool, the
          byte-level specification, the tests and what they do not cover. No
          wallet credentials are shipped. Mainnet custody is disabled.
        </p>
        <a href="https://github.com/plantsweb3/bunker" className="button light">
          Get the working repository
        </a>
      </section>
    </DocumentLayout>
  );
}
