import { describe, expect, it } from "vitest";
import { rewardAccountsOf } from "../lib/creator-reward-accounts";
import { exactSol, labelsFrom, rowOf, type ChainTransaction } from "../lib/vault-transactions";
import checkedIn from "../lib/vault-labels.json";

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
