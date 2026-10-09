import Link from "next/link";
import { DocumentLayout } from "@/components/bunker/document-layout";
export const metadata = { title: "Security & limitations" };
export default function Page() {
  return (
    <DocumentLayout
      eyebrow="SECURITY, WITHOUT THE SHORTCUTS"
      title="Know the boundary."
      description="What the design aims to protect, what it cannot protect, and what still needs review."
    >
      <div className="document-callout">
        <h2>Public beta. Unaudited. Upgradeable.</h2>
        <p>
          Bunker runs on Solana mainnet and holds real funds. The
          implementation has automated tests, but no independent cryptographic
          review or program audit, and none is booked. The program can be
          upgraded by one key, held by its maintainer on a hardware wallet. No
          security certification or quantum-resistance level is claimed. Put
          in only what you could afford to lose.
        </p>
      </div>
      <figure className="explainer">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/assets/diagrams/drainer-boundary.svg"
          width={1280}
          height={720}
          alt="Diagram: with your wallet key an attacker can spend what is in that wallet, pay fees and send assets into a vault; without the Bunker key there is no valid withdrawal authorization. If the device itself is compromised, both keys may be at risk. Labelled as a simulation."
        />
      </figure>
      <section>
        <h2>The intended security boundary</h2>
        <p>
          A connected Solana wallet funds a program-derived vault. To withdraw,
          the program verifies a separate hash-based one-time signature over
          the exact asset, amount and destination, and replaces the key in the
          same step. Possession of the wallet’s signing key alone does not
          satisfy that check.
        </p>
        <p>
          This is a design objective supported by tests, not an external
          assessment of the complete product. The website, the offline tool,
          the deployment process and dependencies remain part of the attack
          surface.
        </p>
      </section>
      <section>
        <h2>Three secrets, and what each can do</h2>
        <ul>
          <li>
            <strong>Your wallet key.</strong> Pays fees and deposits. Cannot
            withdraw from the vault.
          </li>
          <li>
            <strong>Your day key.</strong> Can announce withdrawals. A Bunker
            is built with up to four trusted addresses and a waiting period
            for everything else. If the day key is stolen, the thief can send
            at once only to those trusted addresses, which are yours; a
            withdrawal to any other address waits, and you have that long to
            cancel it with your recovery kit. If you chose no waiting period,
            the thief can withdraw anywhere immediately.
          </li>
          <li>
            <strong>Your recovery kit.</strong> Can replace every key. Whoever
            holds it and its password controls the Bunker. It is opened only
            in an offline tool, never on this website.
          </li>
        </ul>
      </section>
      <section>
        <h2>A published construction. An unreviewed integration.</h2>
        <p>
          The one-time signature is LM-OTS as specified in{" "}
          <a
            href="https://www.rfc-editor.org/rfc/rfc8554#section-4"
            target="_blank"
            rel="noreferrer"
          >
            RFC 8554, section 4
          </a>
          : 34 SHA-256 hash chains, a checksum, and a 1,124-byte signature.
          The verifier in the program and the signer in the browser were
          written from that text and are tested against the test vectors the
          RFC publishes: its signatures must verify, and signing with its
          private key must reproduce its signature.
        </p>
        <p>
          Bunker uses that one-time scheme on its own, with each signature
          naming the key that replaces it, not inside the LMS system the RFC
          mainly describes. That use, and two choices it involves, have not
          been examined by an outside cryptographer. Its security rests on SHA-256;
          the system as a whole is not quantum-resistant, because everything
          else on Solana still uses ordinary signatures.
        </p>
      </section>
      <section>
        <h2>What Bunker does not protect</h2>
        <ul>
          <li>
            <strong>A compromised browser or device.</strong> Malware, malicious
            extensions, injected scripts, or a compromised build can steal a
            day key opened on that device or alter a destination.
          </li>
          <li>
            <strong>A stolen day key with no waiting period.</strong> The
            offline tool starts on a 24-hour wait for any address you have not
            listed as trusted, and lets you turn the wait off. Without it
            there is no time to react. A trusted address is only as safe as
            the wallet behind it: list a hardware wallet, not the wallet you
            connect to websites.
          </li>
          <li>
            <strong>Loss of the recovery kit or its password.</strong> There is
            no reset and no administrator. A lost day key can be replaced only
            with the kit.
          </li>
          <li>
            <strong>One day key used on two devices.</strong> One device cannot
            know what the other has signed. Signing two different messages with
            the same one-time key makes forging a third practical. If that may
            have happened, install new keys with your recovery kit.
          </li>
          <li>
            <strong>A substituted recovery tool.</strong> The offline tool is
            downloaded from this site. Its published hash lets you check it;
            nothing forces you to.
          </li>
          <li>
            <strong>Solana as a whole.</strong> Consensus, transaction fee
            signatures, validator identities, RPC availability, and network
            cryptography remain outside this vault’s protection.
          </li>
          <li>
            <strong>Token issuers and authorities.</strong> Minting, freezing,
            or issuer controls are unchanged. A token can be frozen or lose
            value while held in a vault.
          </li>
          <li>
            <strong>Upgrade authority or deployment compromise.</strong> An
            upgradeable program can change its rules. The current authority must
            be inspected for each deployment.
          </li>
        </ul>
      </section>
      <section>
        <h2>When something goes wrong</h2>
        <p>
          The app reserves a one-time key before signing with it and never
          signs a reserved key again. If a withdrawal is signed but never
          reaches the network, or a tab closes mid-way, that key is finished.
          The remedy is the same every time: in the offline tool, your recovery
          kit installs new keys. Your assets do not move.
        </p>
        <p>
          A withdrawal that is waiting can be cancelled the same way. One that
          has been released cannot be undone.
        </p>
      </section>
      <section>
        <h2>Intentionally narrow asset support</h2>
        <p>
          SOL and ordinary accounts under the classic SPL Token program are
          supported in the test implementation. Token-2022 extensions,
          programmable NFTs, confidential transfers, swaps, bridges, arbitrary
          program execution, staking, and fee relayers are excluded. Vault
          account rent remains reserved.
        </p>
      </section>
      <section>
        <h2>Privacy and incident response</h2>
        <p>
          There is no advertising or analytics code in the app. Public wallet
          addresses and transactions go to the configured Solana RPC provider.
          A day key is handled in browser memory. If you save it with a
          passkey, an encrypted copy is kept in local browser storage, along
          with a record of which one-time keys this browser has used. The
          recovery kit is never handled by this site. JavaScript cannot guarantee erasure of all copies from
          memory.
        </p>
        <p>
          Report vulnerabilities privately through{" "}
          <a
            href="https://github.com/plantsweb3/bunker/security/advisories/new"
            target="_blank"
            rel="noreferrer"
          >
            GitHub private vulnerability reporting
          </a>
          . There is no funded bounty, guaranteed response time, or named
          incident responder yet; those are release requirements.{" "}
          <Link href="/verify">See the release requirements.</Link>
        </p>
      </section>
    </DocumentLayout>
  );
}
