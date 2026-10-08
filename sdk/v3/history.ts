/** What has happened to a vault, read back from the chain (DRAFT).
 *
 * Built from the transactions that reference the vault's address. A token sent
 * straight to one of the vault's token accounts by some other wallet does not
 * reference that address and will not appear here; its balance still shows.
 *
 * A transaction is named after a Bunker instruction only when that
 * instruction acts on THIS vault, whether it was sent directly or made by
 * another program on the sender's behalf. */
import { Connection, PublicKey } from "@solana/web3.js";
export type ActivityKind =
  | "built"
  | "deposit"
  | "announced"
  | "sent"
  | "released"
  | "cleared"
  | "recovered"
  | "other";
export type Activity = {
  signature: string;
  /** Unix seconds, when the chain reports it. */
  time: number | null;
  failed: boolean;
  kind: ActivityKind;
  /** Change in the vault's SOL balance, in lamports. */
  sol: bigint;
  tokens: { mint: string; delta: bigint; decimals: number }[];
};
/** The parts of a fetched transaction this module reads. */
export type FetchedTransaction = {
  blockTime?: number | null;
  meta: {
    err: unknown;
    preBalances: number[];
    postBalances: number[];
    preTokenBalances?: TokenBalance[] | null;
    postTokenBalances?: TokenBalance[] | null;
    /** Instructions made by programs during the transaction; data is base58. */
    innerInstructions?:
      | { instructions: { programIdIndex: number; accounts: number[]; data: string }[] }[]
      | null;
    /** Accounts brought in through address lookup tables. */
    loadedAddresses?: { writable: PublicKey[]; readonly: PublicKey[] } | null;
  } | null;
  transaction: {
    message: {
      staticAccountKeys: PublicKey[];
      compiledInstructions: {
        programIdIndex: number;
        accountKeyIndexes: number[];
        data: Uint8Array;
      }[];
    };
  };
};
type TokenBalance = {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string; decimals: number };
};
const OPCODE = { initialize: 0, announce: 2, execute: 3, expire: 4, recover: 5 } as const;
/** Where each instruction names the vault it acts on. */
const VAULT_ACCOUNT: Record<number, number> = { 0: 1, 2: 0, 3: 0, 4: 0, 5: 0 };
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** The first byte of base58-encoded data, or null if there is none. */
function firstByte(encoded: string): number | null {
  if (encoded.length === 0 || encoded.length > 2000) return null;
  let n = 0n;
  for (const ch of encoded) {
    const digit = ALPHABET.indexOf(ch);
    if (digit < 0) return null;
    n = n * 58n + BigInt(digit);
  }
  // Leading '1's are leading zero bytes.
  if (encoded[0] === "1") return 0;
  let top = n;
  while (top > 255n) top >>= 8n;
  return Number(top);
}
export function describeTransaction(
  signature: string,
  tx: FetchedTransaction,
  program: PublicKey,
  vault: PublicKey,
): Activity {
  const loaded = tx.meta?.loadedAddresses;
  const keys = [
    ...tx.transaction.message.staticAccountKeys,
    ...(loaded?.writable ?? []),
    ...(loaded?.readonly ?? []),
  ];
  const instructions = [
    ...tx.transaction.message.compiledInstructions.map((ix) => ({
      program: ix.programIdIndex,
      accounts: ix.accountKeyIndexes ?? [],
      op: ix.data.length > 0 ? ix.data[0] : null,
    })),
    ...(tx.meta?.innerInstructions ?? []).flatMap((group) =>
      group.instructions.map((ix) => ({
        program: ix.programIdIndex,
        accounts: ix.accounts,
        op: firstByte(ix.data),
      })),
    ),
  ];
  const ops = new Set(
    instructions
      .filter(
        (ix) =>
          ix.op !== null &&
          keys[ix.program]?.equals(program) &&
          keys[ix.accounts[VAULT_ACCOUNT[ix.op]]]?.equals(vault),
      )
      .map((ix) => ix.op),
  );
  const at = keys.findIndex((k) => k.equals(vault));
  const meta = tx.meta;
  const sol =
    at >= 0 && meta && Number.isSafeInteger(meta.preBalances[at]) && Number.isSafeInteger(meta.postBalances[at])
      ? BigInt(meta.postBalances[at]) - BigInt(meta.preBalances[at])
      : 0n;
  const owned = (list?: TokenBalance[] | null) =>
    (list ?? []).filter((b) => b.owner === vault.toBase58() && /^[0-9]+$/.test(b.uiTokenAmount.amount));
  const tokens = new Map<number, { mint: string; delta: bigint; decimals: number }>();
  for (const b of owned(meta?.postTokenBalances))
    tokens.set(b.accountIndex, { mint: b.mint, delta: BigInt(b.uiTokenAmount.amount), decimals: b.uiTokenAmount.decimals });
  for (const b of owned(meta?.preTokenBalances)) {
    const t = tokens.get(b.accountIndex) ?? { mint: b.mint, delta: 0n, decimals: b.uiTokenAmount.decimals };
    tokens.set(b.accountIndex, { ...t, delta: t.delta - BigInt(b.uiTokenAmount.amount) });
  }
  const changed = [...tokens.values()].filter((t) => t.delta !== 0n);
  const kind: ActivityKind = ops.has(OPCODE.recover)
    ? "recovered"
    : ops.has(OPCODE.announce)
      ? ops.has(OPCODE.execute)
        ? "sent"
        : "announced"
      : ops.has(OPCODE.execute)
        ? "released"
        : ops.has(OPCODE.expire)
          ? "cleared"
          : ops.has(OPCODE.initialize)
            ? "built"
            : sol > 0n || changed.some((t) => t.delta > 0n)
              ? "deposit"
              : "other";
  return {
    signature,
    time: tx.blockTime ?? null,
    failed: !meta || meta.err !== null,
    kind,
    sol,
    tokens: changed,
  };
}
export const ACTIVITY_LABEL: Record<ActivityKind, string> = {
  built: "Bunker built",
  deposit: "Deposit",
  announced: "Withdrawal announced",
  sent: "Withdrawal sent",
  released: "Withdrawal released",
  cleared: "Expired withdrawal cleared",
  recovered: "New keys installed",
  other: "Other transaction",
};
/** The most recent transactions that reference the vault, newest first. */
export async function fetchHistory(
  connection: Connection,
  program: PublicKey,
  vault: PublicKey,
  limit = 15,
): Promise<Activity[]> {
  const signatures = await connection.getSignaturesForAddress(vault, { limit });
  const out: Activity[] = [];
  // One request per transaction; the RPC proxy does not accept batches.
  for (let i = 0; i < signatures.length; i += 4)
    out.push(
      ...(await Promise.all(
        signatures.slice(i, i + 4).map(async (s) => {
          const tx = await connection.getTransaction(s.signature, {
            maxSupportedTransactionVersion: 0,
          });
          return tx
            ? describeTransaction(s.signature, tx as unknown as FetchedTransaction, program, vault)
            : ({ signature: s.signature, time: s.blockTime ?? null, failed: s.err !== null, kind: "other", sol: 0n, tokens: [] } satisfies Activity);
        }),
      )),
    );
  return out;
}
