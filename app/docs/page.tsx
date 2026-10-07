import { DocumentLayout } from "@/components/bunker/document-layout";
export const metadata = { title: "How Bunker works" };
export default function Page() {
  return (
    <DocumentLayout
      eyebrow="THE OPERATOR’S MANUAL"
      title="A small vault. An explicit process."
      description="Understand the authorization flow before connecting a wallet or running the test build."
    >
      <section>
        <h2>1. Connect your everyday wallet</h2>
        <p>
          Bunker discovers Solana Wallet Standard wallets such as Phantom,
          Solflare, and Backpack. Connecting reads your public account; it does
          not grant permission to move assets. The public mainnet app currently
          stops at read-only balances.
        </p>
      </section>
      <section>
        <h2>2. Create a separate authorization key</h2>
        <p>
          In the isolated test build, the browser generates independent random
          one-time key material using its cryptographic random-number generator.
          It is not derived from your Solana wallet. An encrypted recovery file
          contains the vault identity, current authority, network, and key
          state.
        </p>
        <p>
          The file uses Web Crypto AES-256-GCM and PBKDF2-SHA256 with 600,000
          iterations, a random 16-byte salt, and a random 12-byte IV. Use a
          long, unique password and keep it separately. Re-open the file to
          verify it before creating a vault.
        </p>
      </section>
      <section>
        <h2>3. Create the vault and deposit</h2>
        <p>
          The program derives the vault address from a random identity. The
          account stores a 32-byte authority commitment and a monotonically
          increasing nonce. Your wallet pays network fees and rent. SOL goes to
          this vault; classic SPL tokens go to its associated token accounts.
        </p>
        <p>
          Creating the vault does not deposit assets automatically. Review the
          asset, amount, and address in a separate deposit transaction.
        </p>
      </section>
      <section>
        <h2>4. Withdraw with an exact authorization</h2>
        <p>
          The signed message commits to the domain, program, vault, nonce, asset
          type, mint, exact destination account, amount, and next authorization
          commitment. A withdrawal moves one asset at a time.
        </p>
        <p>
          A full signature is 1,088 bytes. To stay within legacy transaction
          limits without truncating the digest, the app uploads it in two
          bounded, append-only chunks. A third transaction verifies the complete
          signature, transfers the asset, and rotates authority atomically.
          Successful completion also reclaims proof-account rent.
        </p>
      </section>
      <section>
        <h2>5. Recover an interrupted transfer</h2>
        <p>
          The newest pending recovery file includes the exact signed transfer
          and the next key. Keep it even if your connection drops or your wallet
          rejects a fee transaction. Restore that file and resume the same
          transfer. If it already completed, the app recognizes the next
          on-chain authority and restores it.
        </p>
        <p>
          Never sign a different message with the old key. Browser history alone
          is not sufficient protection against stale backups on another device.
          This limitation is a mandatory part of the external review.
        </p>
      </section>
      <section>
        <h2>Run and review the implementation</h2>
        <p>
          The source bundle includes setup instructions, the canonical wire
          format, local validator tests, a reviewer checklist, and a deployment
          configuration. No wallet credentials are shipped. Production mainnet
          custody remains disabled.
        </p>
        <a
          href="https://github.com/plantsweb3/bunker"
          className="button light"
        >
          Get the working repository
        </a>
      </section>
    </DocumentLayout>
  );
}
