import { describe, it, expect } from "vitest";
import {
  withdrawalBlocker,
  PreflightFacts,
  FEE_BUFFER_LAMPORTS,
} from "../sdk/preflight";
const rent = {
  empty: 890_880n,
  proof: 8_978_400n,
  marker: 946_560n,
  tokenAccount: 2_039_280n,
};
const base: PreflightFacts = {
  kind: "sol",
  amount: 100_000_000n,
  mint: null,
  recipient: "R",
  payerLamports: 1_000_000_000n,
  destinationLamports: 0n,
  destinationIsWallet: true,
  tokenDestination: null,
  rent,
};
const token: PreflightFacts = {
  ...base,
  kind: "token",
  mint: "M",
  amount: 5n,
  tokenDestination: {
    exists: true,
    tokenProgram: true,
    mint: "M",
    owner: "R",
    frozen: false,
  },
};
describe("Withdrawal preflight", () => {
  it("allows an ordinary SOL withdrawal", () => {
    expect(withdrawalBlocker(base)).toBeNull();
  });
  it("blocks SOL that would leave a new recipient below the rent minimum", () => {
    expect(withdrawalBlocker({ ...base, amount: 890_879n })).toMatch(
      /network minimum/,
    );
    expect(withdrawalBlocker({ ...base, amount: 890_880n })).toBeNull();
    expect(
      withdrawalBlocker({ ...base, amount: 1n, destinationLamports: 890_880n }),
    ).toBeNull();
  });
  it("blocks SOL sent to a program or program-owned account", () => {
    expect(
      withdrawalBlocker({
        ...base,
        destinationIsWallet: false,
        destinationLamports: 5_000_000n,
      }),
    ).toMatch(/not a wallet/);
  });
  it("blocks a fee wallet that cannot fund the proof, marker and fees", () => {
    const needed = rent.proof + rent.marker + FEE_BUFFER_LAMPORTS;
    expect(withdrawalBlocker({ ...base, payerLamports: needed - 1n })).toMatch(
      /Add SOL/,
    );
    expect(withdrawalBlocker({ ...base, payerLamports: needed })).toBeNull();
  });
  it("adds token-account rent when the recipient account does not exist", () => {
    const needed = rent.proof + rent.marker + FEE_BUFFER_LAMPORTS;
    const missing = { ...token, tokenDestination: { exists: false as const } };
    expect(withdrawalBlocker({ ...missing, payerLamports: needed })).toMatch(
      /Add SOL/,
    );
    expect(
      withdrawalBlocker({
        ...missing,
        payerLamports: needed + rent.tokenAccount,
      }),
    ).toBeNull();
  });
  it("blocks frozen, foreign or mismatched recipient token accounts", () => {
    const d = token.tokenDestination as Extract<
      PreflightFacts["tokenDestination"],
      { exists: true }
    >;
    expect(withdrawalBlocker(token)).toBeNull();
    for (const bad of [
      { ...d, frozen: true },
      { ...d, mint: "other" },
      { ...d, owner: "other" },
      { ...d, tokenProgram: false },
    ])
      expect(
        withdrawalBlocker({ ...token, tokenDestination: bad }),
      ).toMatch(/Nothing was signed/);
    expect(withdrawalBlocker({ ...token, tokenDestination: null })).toMatch(
      /could not be checked/,
    );
  });
});
