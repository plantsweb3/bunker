import { describe, expect, it } from "vitest";
import { rewardAccountsOf } from "../lib/creator-reward-accounts";
import { exactSol, labelsFrom, rowOf, type ChainTransaction } from "../lib/vault-transactions";
import checkedIn from "../lib/vault-labels.json";
import { PAYMENT_WALLET } from "../lib/bounty";
import {
  balanceOfCall,
  exactUnits,
  paymentLabelsFrom,
  quantity,
  TRANSFER_EVENT,
  USDT_CONTRACT,
  usdtPaid,
  type Receipt,
} from "../lib/payment-wallet";
import paymentLabels from "../lib/payment-labels.json";

const vault = "4pJr11CZC8Edyjoe2A93G2myNorjVeq2o4zWHXyPqrYC";
const rewards = rewardAccountsOf(vault);
const stranger = "9S1sy71VPHM6brxu7oX93vvCVFsQ7o4J9jGvc85iVuQF";
const tipJar = "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe";
const signature = "5".repeat(88);
/** A transaction in which each account's balance changes by the given amount. */
function tx(changes: [string, number][], loaded: [string, number][] = []): ChainTransaction {
  const all = [...changes, ...loaded];
  return {
    transaction: { message: { accountKeys: changes.map(([key]) => key) } },
    meta: {
      preBalances: all.map(() => 10_000_000_000),
      postBalances: all.map(([, change]) => 10_000_000_000 + change),
      loadedAddresses: { writable: loaded.map(([key]) => key), readonly: [] },
    },
  };
}
const row = (t: ChainTransaction, labels = {}) => rowOf({ signature, blockTime: 1_760_000_000 }, t, vault, rewards, labels);

describe("Bounty vault transactions", () => {
  it("prints every lamport and never rounds", () => {
    expect(exactSol(3_854_748_365)).toBe("3.854748365");
    expect(exactSol(1)).toBe("0.000000001");
    expect(exactSol(20_001_000)).toBe("0.020001");
    expect(exactSol(5_000_000_000)).toBe("5");
    expect(() => exactSol(1.5)).toThrow();
    expect(() => exactSol(-1)).toThrow();
  });
  it("reads a deposit: the amount is the vault's change and the other side is who paid", () => {
    expect(row(tx([[stranger, -20_006_000], [vault, 20_001_000]]))).toEqual({
      signature,
      time: 1_760_000_000,
      direction: "IN",
      lamports: 20_001_000,
      other: stranger,
      label: null,
    });
  });
  it("reads a payment, fee included, and names where most of it went", () => {
    const paid = row(tx([[vault, -3_005_002], [tipJar, 3_000_000]]));
    expect(paid).toMatchObject({ direction: "OUT", lamports: 3_005_002, other: tipJar, label: null });
  });
  it("calls it creator rewards only when the SOL came out of the vault's own reward accounts", () => {
    const claim = tx([[vault, 384_264_297], [tipJar, 200_000]], [[rewards.exchangeVault, -404_915_165]]);
    expect(row(claim)).toMatchObject({ direction: "IN", other: rewards.exchangeVault, label: "Creator rewards" });
    expect(row(tx([[vault, 5], [rewards.curveVault, -5]]))?.label).toBe("Creator rewards");
    expect(row(tx([[vault, 5], [stranger, -5]]))?.label).toBeNull();
    // Paying out is never a reward, whatever else the transaction touches.
    expect(row(tx([[vault, -9], [stranger, 5], [rewards.curveVault, -1]]))?.label).toBeNull();
  });
  it("lets a checked-in label win, and only for its own signature", () => {
    expect(row(tx([[vault, -9], [stranger, 4]]), { [signature]: "Audit payment" })?.label).toBe("Audit payment");
    expect(row(tx([[vault, -9], [stranger, 4]]), { ["4".repeat(88)]: "Audit payment" })?.label).toBeNull();
  });
  it("leaves out a transaction that names the vault and moves nothing", () => {
    expect(row(tx([[stranger, -809_578_839], [vault, 0], [rewards.exchangeVault, 7_508_943]]))).toBeNull();
  });
  it("shows a fee with nobody on the other side", () => {
    expect(row(tx([[vault, -5000]]))).toMatchObject({ direction: "OUT", lamports: 5000, other: null });
  });
  it("refuses an answer it cannot account for", () => {
    expect(() => row(tx([[stranger, -5]]))).toThrow();
    expect(() => row({ transaction: { message: { accountKeys: [vault] } }, meta: null })).toThrow();
    const short = tx([[vault, 5], [stranger, -5]]);
    short.meta!.postBalances.pop();
    expect(() => row(short)).toThrow();
    const odd = tx([[vault, 5], [stranger, -5]]);
    odd.meta!.postBalances[0] = 1.5;
    expect(() => row(odd)).toThrow();
  });
  it("accepts the checked-in labels, and refuses anything that is not a signature and a plain label", () => {
    expect(() => labelsFrom(checkedIn)).not.toThrow();
    expect(() => labelsFrom({ nope: "Audit payment" })).toThrow();
    expect(() => labelsFrom({ [signature]: "" })).toThrow();
    expect(() => labelsFrom({ [signature]: "Audit — paid" })).toThrow();
    expect(() => labelsFrom([])).toThrow();
  });
});

describe("Payment wallet on Ethereum", () => {
  it("prints every digit of a balance and never rounds", () => {
    expect(exactUnits(6_010_010_694n, 6)).toBe("6010.010694");
    expect(exactUnits(6_000_000_000n, 6)).toBe("6000");
    expect(exactUnits(17_544_387_715_245_513n, 18)).toBe("0.017544387715245513");
    expect(exactUnits(1n, 18)).toBe("0.000000000000000001");
    expect(exactUnits(0n, 6)).toBe("0");
    expect(() => exactUnits(-1n, 6)).toThrow();
  });
  it("reads a node's numbers and refuses anything else", () => {
    expect(quantity("0x0000000000000000000000000000000000000000000000000000000166397c46")).toBe(6_010_010_694n);
    expect(quantity("0x3e54871591a5c9")).toBe(17_544_387_715_245_513n);
    for (const bad of ["0x", "", "166397c46", null, 5, "0xzz"]) expect(() => quantity(bad)).toThrow();
  });
  it("asks the token contract about the checked-in address and no other", () => {
    expect(balanceOfCall(PAYMENT_WALLET)).toBe(
      "0x70a082310000000000000000000000002f48613a3d1d81adfd30058f4d12b39b8f20101f",
    );
    expect(() => balanceOfCall("0x1234")).toThrow();
  });
  const word = (address: string) => "0x" + address.slice(2).toLowerCase().padStart(64, "0");
  const receiver = "0x" + "ab".repeat(20);
  const transfer = (from: string, to: string, amount: bigint, contract = USDT_CONTRACT) => ({
    address: contract.toLowerCase(),
    topics: [TRANSFER_EVENT, word(from), word(to)],
    data: "0x" + amount.toString(16).padStart(64, "0"),
  });
  const receipt = (...logs: Receipt["logs"] & object): Receipt => ({ status: "0x1", blockNumber: "0x1", logs });
  it("reads what a payment moved from the receipt, and to whom", () => {
    expect(usdtPaid(receipt(transfer(PAYMENT_WALLET, receiver, 6_000_010_694n)), PAYMENT_WALLET)).toEqual({
      amount: 6_000_010_694n,
      to: receiver,
    });
  });
  it("will not describe a transaction that is not one payment out of the wallet", () => {
    const paid = transfer(PAYMENT_WALLET, receiver, 10_000_000n);
    // Failed, or nothing in it.
    expect(() => usdtPaid({ ...receipt(paid), status: "0x0" }, PAYMENT_WALLET)).toThrow();
    expect(() => usdtPaid(receipt(), PAYMENT_WALLET)).toThrow();
    // Money coming in, another token, and the empty transfers scammers attach to a wallet's history.
    expect(() => usdtPaid(receipt(transfer(receiver, PAYMENT_WALLET, 5n)), PAYMENT_WALLET)).toThrow();
    expect(() => usdtPaid(receipt(transfer(PAYMENT_WALLET, receiver, 5n, "0x" + "11".repeat(20))), PAYMENT_WALLET)).toThrow();
    expect(() => usdtPaid(receipt(transfer(PAYMENT_WALLET, receiver, 0n)), PAYMENT_WALLET)).toThrow();
    expect(() => usdtPaid(receipt(paid, transfer(PAYMENT_WALLET, "0x" + "cd".repeat(20), 1n)), PAYMENT_WALLET)).toThrow();
  });
  it("accepts the checked-in payment labels and refuses anything that is not a hash and a plain label", () => {
    expect(() => paymentLabelsFrom(paymentLabels)).not.toThrow();
    expect(() => paymentLabelsFrom({ "0x1234": "Audit payment" })).toThrow();
    expect(() => paymentLabelsFrom({ ["0x" + "a".repeat(64)]: "6000 USDT \u2014 paid" })).toThrow();
  });
});
