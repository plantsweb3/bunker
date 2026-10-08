import type { Page } from "@playwright/test";
import { Keypair, Transaction } from "@solana/web3.js";
/** A disposable Wallet Standard wallet for the isolated LOCAL validator only. */
export async function installLocalWallet(page: Page, payer: Keypair) {
  await page.exposeFunction("localTestSign", async (bytes: number[]) => {
    const tx = Transaction.from(Uint8Array.from(bytes));
    if (!tx.feePayer?.equals(payer.publicKey))
      throw new Error("Unexpected local fee payer");
    tx.partialSign(payer);
    return Array.from(tx.serialize());
  });
  await page.addInitScript(
    ({ address, publicKey }) => {
      const account = {
        address,
        publicKey: Uint8Array.from(publicKey),
        chains: ["solana:localnet"],
        features: ["solana:signTransaction"],
      };
      const wallet = {
        version: "1.0.0",
        name: "Bunker local test wallet",
        icon: "data:image/png;base64,iVBORw0KGgo=",
        chains: ["solana:localnet"],
        accounts: [account],
        features: {
          "standard:connect": {
            version: "1.0.0",
            connect: async () => ({ accounts: [account] }),
          },
          "standard:disconnect": { version: "1.0.0", disconnect: async () => {} },
          "standard:events": { version: "1.0.0", on: () => () => {} },
          "solana:signTransaction": {
            version: "1.0.0",
            supportedTransactionVersions: new Set(["legacy", 0]),
            signTransaction: async ({ transaction }: { transaction: Uint8Array }) => [
              {
                signedTransaction: Uint8Array.from(
                  await (
                    window as unknown as {
                      localTestSign: (b: number[]) => Promise<number[]>;
                    }
                  ).localTestSign(Array.from(transaction)),
                ),
              },
            ],
          },
        },
      };
      window.addEventListener("wallet-standard:app-ready", ((event: CustomEvent) =>
        event.detail.register(wallet)) as EventListener);
    },
    { address: payer.publicKey.toBase58(), publicKey: Array.from(payer.publicKey.toBytes()) },
  );
}
export async function connect(page: Page) {
  await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
  await page.getByRole("button", { name: "Bunker local test wallet Connect" }).click();
}
