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
        <h2>Experimental. Unaudited. No real-fund custody.</h2>
        <p>
          The implementation has automated tests, but no completed independent
          cryptographic review or program audit. Mainnet creation, deposits, and
          withdrawals are disabled in this release. No security certification or
          quantum-resistance level is claimed.
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
          A connected Solana wallet funds a program-derived vault. The program
          verifies a separate Winternitz one-time signature before a withdrawal
          and atomically replaces the authorization commitment. Possession of
          the original wallet signing key alone is not sufficient to satisfy
          that check.
        </p>
        <p>
          This is a design objective supported by local tests, not an external
          assessment of the complete product. The website, recovery workflow,
          deployment process, and dependencies remain part of the attack
          surface.
        </p>
      </section>
      <section>
        <h2>Documented prior art. Unreviewed integration.</h2>
        <p>
          The Rust verifier is vendored from{" "}
          <a
            href="https://github.com/blueshift-gg/winterwallet/tree/672fc6789b1532ee680f24842d235e0be8737b61"
            target="_blank"
            rel="noreferrer"
          >
            Blueshift’s Winterwallet
          </a>
          , which explicitly states that it is not formally audited. Bunker uses
          its full 32-byte message digest, 34 SHA-256 chains, checksum, and
          tagged Merkle commitment. A browser port is checked against upstream
          Rust vectors.
        </p>
        <p>
          This construction is not WOTS+, XMSS, LMS, or a NIST-approved Bunker
          scheme. We do not equate use of SHA-256 with review of the whole
          signature construction.
        </p>
      </section>
      <section>
        <h2>What Bunker does not protect</h2>
        <ul>
          <li>
            <strong>A compromised browser or device.</strong> Malware, malicious
            extensions, injected scripts, or a compromised build can steal a
            recovery key or alter a destination.
          </li>
          <li>
            <strong>Recovery-file loss or password loss.</strong> There is no
            reset, administrator recovery, or wallet-key fallback.
          </li>
          <li>
            <strong>One-time-key reuse.</strong> Old backups, multiple devices,
            forks, or separate origins can bypass a browser’s local safeguards.
            Two different messages signed with the same key may weaken security.
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
        <h2>One-time signatures require careful recovery</h2>
        <p>
          The app reserves an exact withdrawal before signing and saves an
          encrypted pending recovery file before uploading the signature. If
          submission is interrupted, only that exact withdrawal can be resumed.
          A successful withdrawal advances the on-chain nonce and changes the
          authorization root in the same transaction.
        </p>
        <p>
          A pending transfer cannot simply be changed or cancelled. If its
          destination or token becomes unusable, funds may be stuck. Do not
          erase local signing history or restore an older backup to make a
          different transfer. Browser locks cannot coordinate different devices.
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
          Recovery secrets are handled in browser memory; only
          password-encrypted pending files may be stored in local browser
          storage. JavaScript cannot guarantee erasure of all copies from
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
