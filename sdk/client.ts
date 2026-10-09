import "./polyfill";
import {
  Connection,
  PublicKey,
  Transaction,
  VersionedTransaction,
  TransactionInstruction,
  SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getMint,
} from "./classic-token";
import { BunkerConfig, MAINNET_GENESIS, MAINNET_PROGRAM_ID } from "../lib/bunker-config";
import { formatAmount } from "./bytes";
export type Asset = {
  key: string;
  mint: string | null;
  account: string | null;
  label: string;
  amount: bigint;
  decimals: number;
  frozen: boolean;
};
export function createConnection() {
  return new Connection(
    `${typeof window === "undefined" ? "http://localhost" : window.location.origin}/api/rpc`,
    { commitment: "confirmed", disableRetryOnRateLimit: true },
  );
}
export async function assertNetwork(
  connection: Connection,
  config: BunkerConfig,
  write = false,
) {
  if (write && !config.custodyEnabled) throw new Error(config.releaseStatus);
  const hash = await connection.getGenesisHash();
  if (!config.expectedGenesis || hash !== config.expectedGenesis)
    throw new Error(
      "RPC network does not match the pinned network. Operation blocked.",
    );
  // On mainnet there is one Bunker program. A configuration, a key file or a
  // network card that names another is refused before anything is signed.
  if (
    write &&
    (hash === MAINNET_GENESIS || config.network === "mainnet-beta") &&
    (hash !== MAINNET_GENESIS || config.network !== "mainnet-beta" || config.programId !== MAINNET_PROGRAM_ID)
  )
    throw new Error("On mainnet, only the published Bunker program is used. Operation blocked.");
  if (write) {
    if (!config.programId) throw new Error("No program configured");
    const info = await connection.getAccountInfo(
      new PublicKey(config.programId),
    );
    if (!info?.executable)
      throw new Error("Bunker program is not deployed on this network");
  }
}
export async function assets(
  connection: Connection,
  owner: PublicKey,
): Promise<Asset[]> {
  const [balance, tokens] = await Promise.all([
    connection.getBalance(owner),
    connection.getParsedTokenAccountsByOwner(owner, {
      programId: TOKEN_PROGRAM_ID,
    }),
  ]);
  if (!Number.isSafeInteger(balance))
    throw new Error("SOL balance exceeds this RPC client’s safe integer range");
  return [
    {
      key: "SOL",
      mint: null,
      account: null,
      label: "SOL",
      amount: BigInt(balance),
      decimals: 9,
      frozen: false,
    },
    ...tokens.value.flatMap((t) => {
      const p = t.account.data.parsed?.info;
      if (!p || p.tokenAmount.decimals > 18) return [];
      return [
        {
          key: t.pubkey.toBase58(),
          mint: p.mint,
          account: t.pubkey.toBase58(),
          label: `SPL · ${p.mint.slice(0, 4)}…${p.mint.slice(-4)}`,
          amount: BigInt(p.tokenAmount.amount),
          decimals: p.tokenAmount.decimals,
          frozen: p.state === "frozen",
        },
      ];
    }),
  ];
}
export function explorer(
  signature: string,
  network: BunkerConfig["network"],
  kind = "tx",
) {
  return network === "localnet"
    ? null
    : `https://explorer.solana.com/${kind}/${signature}${network === "devnet" ? "?cluster=devnet" : ""}`;
}
/** The transaction was broadcast and its outcome is not known. It may have
 * landed. Callers must look at the chain before doing anything again. */
export class UnconfirmedError extends Error {
  constructor(public readonly signature: string) {
    super(
      "This step was sent to the network but could not be confirmed. It may have gone through. Check what your Bunker shows before trying anything again.",
    );
  }
}
export async function confirm(
  connection: Connection,
  signature: string,
  lastValidBlockHeight: number,
) {
  for (let i = 0; i < 75; i++) {
    const [statuses, height] = await Promise.all([
      connection.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      }),
      connection.getBlockHeight(),
    ]);
    const status = statuses.value[0];
    if (status?.err)
      throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
    if (
      status?.confirmationStatus === "confirmed" ||
      status?.confirmationStatus === "finalized"
    )
      return;
    if (height > lastValidBlockHeight)
      throw new Error(
        `Confirmation uncertain: ${signature}. Refresh chain state before retrying.`,
      );
    await new Promise((r) => setTimeout(r, 1200));
  }
  throw new Error(
    `Confirmation timed out: ${signature}. Refresh chain state before retrying.`,
  );
}
export async function send(
  connection: Connection,
  config: BunkerConfig,
  payer: PublicKey,
  ixs: TransactionInstruction[],
  sign: (tx: Transaction, chain: string) => Promise<Transaction>,
  onSignature?: (sig: string) => void,
) {
  await assertNetwork(connection, config, true);
  const latest = await connection.getLatestBlockhash();
  const tx = new Transaction({ ...latest, feePayer: payer }).add(...ixs);
  if (
    tx.serialize({ requireAllSignatures: false, verifySignatures: false })
      .length > 1232
  )
    throw new Error("Transaction exceeds the supported legacy size");
  const sim = await connection.simulateTransaction(
    new VersionedTransaction(tx.compileMessage()),
    { sigVerify: false },
  );
  if (sim.value.err)
    throw new Error(
      `The network would reject this step (${JSON.stringify(sim.value.err)}). This step was not sent.`,
    );
  const signed = await sign(
    tx,
    config.network === "localnet" ? "solana:localnet" : "solana:devnet",
  );
  await assertNetwork(connection, config, true);
  const signature = await connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  onSignature?.(signature);
  try {
    await confirm(connection, signature, latest.lastValidBlockHeight);
  } catch (e) {
    // A definite on-chain failure is reported as such. Anything else (a
    // timeout, a dropped connection while polling) leaves the outcome unknown.
    if (e instanceof Error && e.message.startsWith("Transaction failed")) throw e;
    throw new UnconfirmedError(signature);
  }
  return signature;
}
export async function depositIxs(
  payer: PublicKey,
  vault: PublicKey,
  asset: Asset,
  amount: bigint,
) {
  if (amount <= 0n || amount > asset.amount || asset.frozen)
    throw new Error("Insufficient transferable balance");
  if (!asset.mint)
    return [
      SystemProgram.transfer({
        fromPubkey: payer,
        toPubkey: vault,
        lamports: amount,
      }),
    ];
  const mint = new PublicKey(asset.mint),
    source = new PublicKey(asset.account!),
    ata = await getAssociatedTokenAddress(mint, vault, true);
  return [
    createAssociatedTokenAccountIdempotentInstruction(payer, ata, vault, mint),
    createTransferCheckedInstruction(
      source,
      mint,
      ata,
      payer,
      amount,
      asset.decimals,
    ),
  ];
}
export async function withdrawalDestination(
  connection: Connection,
  payer: PublicKey,
  recipient: PublicKey,
  asset: Asset,
) {
  if (!PublicKey.isOnCurve(recipient.toBytes()))
    throw new Error(
      "Use a normal wallet recipient; off-curve recipients are not supported in this release.",
    );
  if (!asset.mint)
    return { destination: recipient, setup: [] as TransactionInstruction[] };
  const mint = new PublicKey(asset.mint);
  await getMint(connection, mint);
  const ata = await getAssociatedTokenAddress(mint, recipient);
  return {
    destination: ata,
    setup: [
      createAssociatedTokenAccountIdempotentInstruction(
        payer,
        ata,
        recipient,
        mint,
      ),
    ],
  };
}
export const displayAsset = (a: Asset) =>
  `${formatAmount(a.amount, a.decimals)} ${a.mint ? "tokens" : "SOL"}`;
