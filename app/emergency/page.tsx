import Link from "next/link";
import { DocumentLayout } from "@/components/bunker/document-layout";
export const metadata = {
  title: "My wallet was drained",
  description:
    "What to do in the first hour after a Solana wallet is drained: stop the loss, move what is left, revoke approvals, and avoid recovery scams.",
};
export default function Page() {
  return (
    <DocumentLayout
      eyebrow="PREPARE. DON’T PANIC."
      title="My wallet was drained."
      description="What to do in the first hour, in order. This applies whether or not you use Bunker."
    >
      <div className="document-callout">
        <h2>First: nobody can reverse it for a fee.</h2>
        <p>
          People will message you offering to recover your funds. They are the
          second scam. No one from Bunker, a wallet, or an exchange will ask
          for a seed phrase, a recovery kit, or an upfront payment.
        </p>
      </div>
      <section>
        <h2>1. Stop signing</h2>
        <p>
          Close the site that asked for the approval. Do not approve anything
          else from the affected wallet “to cancel” or “to verify”. If you
          typed a seed phrase into a page, treat that seed as public from this
          moment.
        </p>
      </section>
      <section>
        <h2>2. Make a new wallet on a device you trust</h2>
        <p>
          Create a wallet with a <strong>new seed phrase</strong>, not another
          account under the old one. If you suspect malware, do this on a
          different device. Write the new phrase on paper; do not screenshot
          it or store it in notes or cloud storage.
        </p>
      </section>
      <section>
        <h2>3. Move what is left, most valuable first</h2>
        <ul>
          <li>
            Send remaining tokens and NFTs to the new wallet. Start with what
            you would miss most.
          </li>
          <li>
            Staked SOL takes time to unstake. Start now; if the attacker has
            your key they can do the same, and whoever moves first wins.
          </li>
          <li>
            If SOL you send in for fees disappears within seconds, a bot is
            sweeping the wallet. Stop sending SOL to it.
          </li>
          <li>
            If a token still shows but will not move, its account may have
            been reassigned to the attacker. It looks like yours and is not.
          </li>
        </ul>
      </section>
      <section>
        <h2>4. Check for approvals that are still open</h2>
        <p>
          Some drains leave a standing approval that lets the attacker take
          tokens again later.{" "}
          <Link href="/check">Check the wallet’s open token approvals</Link>,
          then revoke any you do not recognise from your wallet’s settings.
          Revoking does not help if the seed phrase itself leaked; in that
          case only moving assets to a new wallet does.
        </p>
      </section>
      <section>
        <h2>5. Work out how it happened</h2>
        <ul>
          <li>
            <strong>You approved a transaction on a site.</strong> The key may
            be safe, but assume it is not until you have moved everything.
          </li>
          <li>
            <strong>You entered a seed phrase somewhere.</strong> Every wallet
            from that phrase, on every chain, is compromised.
          </li>
          <li>
            <strong>Neither.</strong> Suspect malware, a fake wallet app or
            extension, or a seed phrase stored in photos, notes or a password
            manager that was breached. Clean or replace the device before
            using the new wallet on it.
          </li>
        </ul>
      </section>
      <section>
        <h2>6. Keep a record and report it</h2>
        <p>
          Save the transaction signatures, the attacker’s addresses, the site
          address, and screenshots. If funds went to an exchange deposit
          address, contact that exchange’s support with the transaction
          signatures immediately; it is the one case where a freeze is
          sometimes possible. Report the theft to your local police or
          national cybercrime unit. Recovery is rare, but a report is needed
          for tax, insurance and any later action.
        </p>
      </section>
      <section>
        <h2>If you have a Bunker</h2>
        <p>
          A Bunker is built so that the drained wallet’s key cannot authorize
          a withdrawal from it. Do not rush. From a clean device, open it with
          your day key and withdraw to the <em>new</em> wallet, never back to
          the drained one. Any wallet can pay the network fee. If the day key
          was on the compromised device, use your recovery kit in the offline
          tool to install new keys first. If the recovery kit itself was on
          that device, withdraw immediately.
        </p>
        <p>
          Bunker is a pre-release and does not hold real funds yet.{" "}
          <Link href="/security">Read what it does and does not stop.</Link>
        </p>
      </section>
    </DocumentLayout>
  );
}
