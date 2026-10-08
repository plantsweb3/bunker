import { describe, it, expect } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { describeTransaction, FetchedTransaction } from "../sdk/v3/history";
const program = new PublicKey(new Uint8Array(32).fill(11));
const vault = new PublicKey(new Uint8Array(32).fill(7));
const payer = new PublicKey(new Uint8Array(32).fill(5));
const system = PublicKey.default;
const keys = [payer, vault, program, system];
const tx = (
  ops: (number | "system")[],
  balances: [number, number] = [5_000_000, 5_000_000],
  extra: Partial<NonNullable<FetchedTransaction["meta"]>> = {},
): FetchedTransaction => ({
  blockTime: 1_800_000_000,
  meta: { err: null, preBalances: [9, balances[0], 1, 1], postBalances: [8, balances[1], 1, 1], ...extra },
  transaction: {
    message: {
      staticAccountKeys: keys,
      compiledInstructions: ops.map((op) =>
        op === "system"
          ? { programIdIndex: 3, accountKeyIndexes: [0, 1], data: new Uint8Array([2, 0, 0, 0]) }
          : // `initialize` names the vault second; every other instruction, first.
            { programIdIndex: 2, accountKeyIndexes: op === 0 ? [0, 1, 3] : [1, 0], data: new Uint8Array([op, 1, 2]) },
      ),
    },
  },
});
const kind = (t: FetchedTransaction) => describeTransaction("sig", t, program, vault).kind;
describe("Vault activity", () => {
  it("names each kind of transaction from the program's instructions", () => {
    expect(kind(tx([0]))).toBe("built");
    expect(kind(tx([2]))).toBe("announced");
    expect(kind(tx([2, 3], [5_000_000, 4_000_000]))).toBe("sent");
    expect(kind(tx([3], [5_000_000, 4_000_000]))).toBe("released");
    expect(kind(tx([4]))).toBe("cleared");
    expect(kind(tx([5]))).toBe("recovered");
    // Recovery in the same transaction as anything else is still a recovery.
    expect(kind(tx([5, 2]))).toBe("recovered");
  });
  it("ignores Bunker instructions that act on a different vault", () => {
    // Someone recovers a Bunker of their own in a transaction that merely
    // mentions this one: this vault's log must not show new keys.
    for (const op of [0, 2, 3, 4, 5]) {
      const t = tx([op], [5_000_000, 5_000_001]);
      t.transaction.message.compiledInstructions[0].accountKeyIndexes = op === 0 ? [0, 0, 3] : [0, 1];
      expect(kind(t), `opcode ${op}`).toBe("deposit");
    }
  });
  it("sees Bunker instructions made through another program", () => {
    // Base58 "3" is the single byte 0x02 (announce); "4" is 0x03 (execute).
    const wrapped = tx(["system"], [5_000_000, 4_000_000], {
      innerInstructions: [
        { instructions: [{ programIdIndex: 2, accounts: [1, 0], data: "3" }, { programIdIndex: 2, accounts: [1, 0], data: "4" }] },
      ],
    });
    expect(kind(wrapped)).toBe("sent");
    const recover = tx(["system"], [1, 1], {
      innerInstructions: [{ instructions: [{ programIdIndex: 2, accounts: [1], data: "6" }] }],
    });
    expect(kind(recover)).toBe("recovered");
    // The same call aimed at another vault, or to another program, is not ours.
    const elsewhere = tx(["system"], [1, 1], {
      innerInstructions: [{ instructions: [{ programIdIndex: 2, accounts: [0], data: "6" }, { programIdIndex: 3, accounts: [1], data: "6" }] }],
    });
    expect(kind(elsewhere)).toBe("other");
    // A vault reached through an address lookup table is still recognised.
    const viaTable = tx([5]);
    viaTable.transaction.message.staticAccountKeys = [payer, payer, program, system];
    viaTable.transaction.message.compiledInstructions[0].accountKeyIndexes = [4];
    viaTable.meta!.loadedAddresses = { writable: [vault], readonly: [] };
    expect(kind(viaTable)).toBe("recovered");
  });
  it("treats an incoming transfer as a deposit and anything else as other", () => {
    const deposit = describeTransaction("sig", tx(["system"], [1_000, 2_500]), program, vault);
    expect([deposit.kind, deposit.sol]).toEqual(["deposit", 1_500n]);
    expect(kind(tx(["system"]))).toBe("other");
    // A system instruction whose first data byte happens to be 2 is not an announcement.
    expect(kind(tx(["system"], [10, 5]))).toBe("other");
  });
  it("reports SOL and token changes for the vault only", () => {
    const mint = "So11111111111111111111111111111111111111112";
    const balance = (index: number, owner: PublicKey, amount: string) => ({
      accountIndex: index,
      mint,
      owner: owner.toBase58(),
      uiTokenAmount: { amount, decimals: 6 },
    });
    const a = describeTransaction(
      "sig",
      tx([2, 3], [9_000_000, 9_000_000], {
        preTokenBalances: [balance(4, vault, "300"), balance(5, payer, "0")],
        postTokenBalances: [balance(4, vault, "180"), balance(5, payer, "120")],
      }),
      program,
      vault,
    );
    expect(a.kind).toBe("sent");
    expect(a.sol).toBe(0n);
    expect(a.tokens).toEqual([{ mint, delta: -120n, decimals: 6 }]);
    // A token account that first appears in this transaction.
    const first = describeTransaction(
      "sig",
      tx(["system"], [1, 1], { preTokenBalances: [], postTokenBalances: [balance(4, vault, "75")] }),
      program,
      vault,
    );
    expect([first.kind, first.tokens[0].delta]).toEqual(["deposit", 75n]);
  });
  it("marks failures and tolerates missing data", () => {
    const failed = describeTransaction("sig", tx([2], [1, 1], { err: { InstructionError: [0, "Custom"] } }), program, vault);
    expect([failed.failed, failed.kind]).toEqual([true, "announced"]);
    const bare = describeTransaction("sig", { ...tx([3]), meta: null, blockTime: null }, program, vault);
    expect([bare.failed, bare.time, bare.sol]).toEqual([true, null, 0n]);
    // The vault is not among the accounts: no balance change is invented.
    const elsewhere = tx([3], [1, 2]);
    elsewhere.transaction.message.staticAccountKeys = [payer, payer, program, system];
    expect(describeTransaction("sig", elsewhere, program, vault).sol).toBe(0n);
  });
});
