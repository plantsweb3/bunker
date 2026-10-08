import { DocumentLayout } from "@/components/bunker/document-layout";
export const metadata = {
  title: "Privacy",
  description: "What bunkermode.io collects, what leaves your browser, and what it stores.",
};
export default function Page() {
  return (
    <DocumentLayout
      eyebrow="PRIVACY"
      title="What this site knows about you."
      description="Short version: no accounts, no analytics, no cookies. A few things necessarily leave your browser, listed below."
    >
      <section>
        <h2>What we do not collect</h2>
        <ul>
          <li>No account, email address or name is required or requested.</li>
          <li>
            No analytics, advertising or tracking scripts, and no third-party
            scripts of any kind. Fonts and images are served from this site.
          </li>
          <li>No cookies are set by this site.</li>
          <li>
            Passwords and Bunker keys are never sent to a server. A day key
            is handled in your browser; a recovery kit is handled only in the
            offline tool and never by this site.
          </li>
        </ul>
      </section>
      <section>
        <h2>What leaves your browser</h2>
        <ul>
          <li>
            <strong>Page requests.</strong> The site is hosted on Vercel,
            which processes your IP address and browser details to deliver
            pages and keeps operational logs under its own policy.
          </li>
          <li>
            <strong>Solana reads.</strong> When you connect a wallet or use
            the wallet check, the public address and the request are passed
            through this site’s server to a Solana RPC provider, which can see
            the address being queried. Wallet addresses and balances are
            public on the Solana network.
          </li>
          <li>
            <strong>Links you follow</strong> to GitHub, X or a block explorer
            are governed by those services.
          </li>
        </ul>
      </section>
      <section>
        <h2>What is stored on your device</h2>
        <p>
          In test configurations that allow creating a vault, the app keeps a
          record in this browser’s local storage of which one-time keys it
          has used and of a signed withdrawal that has not been announced yet,
          so that an interrupted one can be resumed. If you choose passkey
          unlock, an encrypted copy of your day key is stored there too.
          Clearing site data removes them. The
          public mainnet site is read-only and stores nothing.
        </p>
      </section>
      <section>
        <h2>Telegram alerts</h2>
        <p>
          Alerts are optional. If you turn them on for a Bunker, the site
          stores your Telegram chat ID and the address of each Bunker you
          watch, so it can message you when something happens there. It stores
          no keys and no wallet address. Telegram, which delivers the
          messages, knows the same. Send <code>/stop</code> to the bot and the
          record is deleted. Alerts can be late or missing; silence is not
          proof that nothing happened.
        </p>
      </section>
      <section>
        <h2>The wallet check</h2>
        <p>
          The address you paste is used for that lookup and is not stored by
          this site. If you copy a result link, the address is part of the
          link.
        </p>
      </section>
      <section>
        <h2>Changes and contact</h2>
        <p>
          This page describes the current pre-release and will be updated
          before real funds are accepted, including any alert service that
          needs a contact address. The site’s source is public, so each claim
          here can be checked against the code. Questions:{" "}
          <a href="https://x.com/BunkerModeIO" target="_blank" rel="noreferrer">
            @BunkerModeIO
          </a>{" "}
          or a{" "}
          <a
            href="https://github.com/plantsweb3/bunker/issues"
            target="_blank"
            rel="noreferrer"
          >
            GitHub issue
          </a>
          .
        </p>
      </section>
    </DocumentLayout>
  );
}
