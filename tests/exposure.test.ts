import { describe, it, expect } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { summarizeExposure, TOKEN_2022_PROGRAM_ID } from "../sdk/exposure";
const info = (amount: string, extra: object = {}) => ({
  mint: "So11111111111111111111111111111111111111112",
  state: "initialized",
  tokenAmount: { amount, decimals: 6 },
  ...extra,
});
describe("Wallet exposure summary", () => {
  it("uses a well-formed Token-2022 program id", () => {
    expect(new PublicKey(TOKEN_2022_PROGRAM_ID).toBytes()).toHaveLength(32);
  });
  it("separates movable, approved, unsupported, frozen and empty accounts", () => {
    const e = summarizeExposure(
      2_500_000_000,
      [
        { account: "a", info: info("10") },
        { account: "b", info: info("0") },
        { account: "c", info: info("7", { state: "frozen" }) },
        {
          account: "d",
          info: info("5", { delegate: "x", delegatedAmount: { amount: "5" } }),
        },
        {
          account: "e",
          info: info("5", { delegate: "x", delegatedAmount: { amount: "0" } }),
        },
      ],
      [{ account: "f", info: info("3") }],
    );
    expect(e.lamports).toBe(2_500_000_000n);
    expect(e.movable.map((t) => t.account).sort()).toEqual(["a", "d", "e", "f"]);
    expect(e.approvals.map((t) => t.account)).toEqual(["d"]);
    expect(e.supported.map((t) => t.account).sort()).toEqual(["a", "d", "e"]);
    expect(e.unsupported.map((t) => t.account)).toEqual(["f"]);
    expect(e.frozen).toBe(1);
    expect(e.emptyAccounts).toBe(1);
  });
  it("ignores a frozen account's approval and drops malformed rows", () => {
    const e = summarizeExposure(
      0,
      [
        {
          account: "a",
          info: info("9", {
            state: "frozen",
            delegate: "x",
            delegatedAmount: { amount: "9" },
          }),
        },
        { account: "b", info: info("1e3") },
        { account: "c", info: { ...info("1"), tokenAmount: { amount: "1", decimals: 40 } } },
      ],
      [],
    );
    expect(e.approvals).toEqual([]);
    expect(e.movable).toEqual([]);
    expect(e.frozen).toBe(1);
  });
  it("rejects an unsafe SOL balance", () => {
    expect(() => summarizeExposure(Number.MAX_SAFE_INTEGER + 2, [], [])).toThrow();
  });
});
describe("Approvals on empty accounts", () => {
  it("still counts: the approval applies to whatever arrives later", () => {
    const e = summarizeExposure(
      1,
      [{ account: "z", info: info("0", { delegate: "x", delegatedAmount: { amount: "9" } }) }],
      [],
    );
    expect(e.approvals.map((t) => t.account)).toEqual(["z"]);
  });
});
