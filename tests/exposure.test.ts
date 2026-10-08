import { describe, it, expect } from "vitest";
import { PublicKey } from "@solana/web3.js";
import {
  permanentDelegate,
  RAW_TOKEN_BYTES,
  rawTokenInfo,
  summarizeExposure,
  TOKEN_2022_PROGRAM_ID,
} from "../sdk/exposure";
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
  it("flags Token-2022 balances their issuer can move, frozen or not", () => {
    const e = summarizeExposure(
      0,
      [{ account: "a", info: { ...info("4"), mint: "taken" } }],
      [
        { account: "b", info: { ...info("5"), mint: "taken" } },
        { account: "c", info: { ...info("6", { state: "frozen" }), mint: "taken" } },
        { account: "d", info: { ...info("0"), mint: "taken" } },
        { account: "e", info: { ...info("7"), mint: "free" } },
      ],
      new Map([["taken", "issuer"]]),
    );
    // Only Token-2022 has the feature; an empty account has nothing to take.
    expect(e.issuerMovable.map((t) => [t.account, t.issuer])).toEqual([["b", "issuer"], ["c", "issuer"]]);
    expect(e.movable.find((t) => t.account === "a")!.issuer).toBeNull();
    expect(e.movable.find((t) => t.account === "e")!.issuer).toBeNull();
  });
  it("reads a mint's permanent delegate and nothing that only looks like one", () => {
    const key = "9".repeat(44);
    const mint = (extensions: unknown) => ({ decimals: 6, extensions });
    expect(permanentDelegate(mint([{ extension: "transferFeeConfig", state: {} }, { extension: "permanentDelegate", state: { delegate: key } }]))).toBe(key);
    for (const none of [
      mint([{ extension: "permanentDelegate", state: { delegate: null } }]),
      mint([{ extension: "transferHook", state: { delegate: key } }]),
      mint("permanentDelegate"),
      mint(undefined),
      null,
      "x",
    ])
      expect(permanentDelegate(none)).toBeNull();
  });
  it("reads a token account from its first bytes when a wallet is too large to parse", () => {
    const base58 = (b: Uint8Array) => new PublicKey(b).toBase58();
    const data = new Uint8Array(RAW_TOKEN_BYTES);
    const view = new DataView(data.buffer);
    data.fill(3, 0, 32); // mint
    data.fill(4, 32, 64); // owner
    view.setBigUint64(64, 123_456_789_012_345_678n, true);
    data[108] = 1;
    const plain = rawTokenInfo(data, base58)!;
    expect([plain.mint, plain.tokenAmount.amount, plain.state, plain.delegate]).toEqual([
      new PublicKey(new Uint8Array(32).fill(3)).toBase58(),
      "123456789012345678",
      "initialized",
      undefined,
    ]);
    view.setUint32(72, 1, true);
    data.fill(5, 76, 108);
    view.setBigUint64(121, 77n, true);
    data[108] = 2;
    const approved = rawTokenInfo(data, base58)!;
    expect([approved.delegate, approved.delegatedAmount?.amount, approved.state]).toEqual([
      new PublicKey(new Uint8Array(32).fill(5)).toBase58(),
      "77",
      "frozen",
    ]);
    // Uninitialised, a state that does not exist, and a short read are dropped.
    for (const state of [0, 3]) {
      const bad = data.slice();
      bad[108] = state;
      expect(rawTokenInfo(bad, base58)).toBeNull();
    }
    expect(rawTokenInfo(data.slice(0, RAW_TOKEN_BYTES - 1), base58)).toBeNull();
    // Such a row is counted, with its amount in base units and no decimals.
    data[108] = 1;
    const e = summarizeExposure(0, [{ account: "a", info: rawTokenInfo(data, base58)! }], []);
    expect([e.movable.length, e.movable[0].decimals, e.approvals.length]).toEqual([1, null, 1]);
  });
});
