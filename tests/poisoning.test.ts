import { describe, expect, it } from "vitest";
import { findLookalikes, looksLike, movementOf, type JsonTransaction, type Movement } from "../lib/poisoning";

// Addresses from the bounty vault's own history: it paid TXmH…, and minutes
// later TXmd… sent it 0.000001 SOL.
const vault = "4pJr11CZC8Edyjoe2A93G2myNorjVeq2o4zWHXyPqrYC";
const real = "TXmH5552Hw7pkjBTLnoMVJkEkPTC3ZV4LY1sD1nsuio";
const fake = "TXmdRPtbS54LSP6wgJ5ybgLf1d5AUBqJMgf1yGNsuio";
const swap = "2zREJwU9v4Jovd4P6XVcqcZJWrxMHxypmDkpXDHDC6Hn";
const spammer = "zUPMpHtC2atBK8WjSXAWEF85ZMiVyV4CW5mDwtyoLzx";
const mint = "BunkeRhcyfJ7dXXNA3kDi421tLijrqudb9ARytKrVbFa";

/** A transaction in which each account's SOL changes by the given amount; the first `signers` keys signed. */
function tx(signature: string, signers: number, changes: [string, number][], tokens: Movement["tokens"] = []): Movement {
  return {
    signature,
    time: 1_791_770_000,
    keys: changes.map(([k]) => k),
    signers,
    sol: changes.map(([, d]) => ({ pre: 10_000_000_000n, post: 10_000_000_000n + BigInt(d) })),
    tokens,
  };
}
const sig = (c: string) => c.repeat(88);

describe("Lookalike addresses", () => {
  it("matches what a wallet shows: the start and the end", () => {
    expect(looksLike(fake, real)).toEqual({ start: 3, end: 4 });
    expect(looksLike(real, real)).toBeNull();
    expect(looksLike(swap, real)).toBeNull();
    // Too little in common to fool anyone, or nothing at one end.
    expect(looksLike("TXm" + "a".repeat(37) + "uio", real)).toBeNull();
    expect(looksLike("TXmH5552" + "a".repeat(36), real)).toBeNull();
  });
  it("finds the sender that imitates an address the wallet paid", () => {
    const history = [
      tx(sig("3"), 1, [[fake, -1050], [vault, 1000]]),
      tx(sig("4"), 1, [[vault, -500_079_934], [real, 500_000_000]]),
    ];
    expect(findLookalikes(vault, history)).toEqual([
      {
        sender: fake,
        imitates: real,
        start: 3,
        end: 4,
        signature: sig("3"),
        time: 1_791_770_000,
        received: { lamports: 1000n },
      },
    ]);
  });
  it("does not flag the real address, a stranger's spam, or money the wallet sent itself", () => {
    const history = [
      tx(sig("4"), 1, [[vault, -500_079_934], [real, 500_000_000]]),
      // The real one paying back is not a fake.
      tx(sig("5"), 1, [[real, -2000], [vault, 1000]]),
      // Dust from an address that looks like nothing the wallet paid.
      tx(sig("6"), 1, [[spammer, -5018], [vault, 1]]),
      // The wallet's own transaction that happens to touch a lookalike.
      tx(sig("7"), 1, [[vault, 10], [fake, -10]]),
    ];
    expect(findLookalikes(vault, history)).toEqual([]);
  });
  it("sees token payments too, both the one paid and the fake that sends tokens back", () => {
    const history = [
      tx(sig("8"), 1, [[vault, -5000], [real, 0]], [
        { owner: vault, mint, pre: 100n, post: 40n },
        { owner: real, mint, pre: 0n, post: 60n },
      ]),
      tx(sig("9"), 1, [[fake, -5000], [vault, 0]], [
        { owner: fake, mint, pre: 5n, post: 4n },
        { owner: vault, mint, pre: 40n, post: 41n },
      ]),
    ];
    expect(findLookalikes(vault, history)).toMatchObject([
      { sender: fake, imitates: real, signature: sig("9"), received: { mint, amount: 1n } },
    ]);
  });
  it("reads a transaction as the network sends it, lookup-table accounts included", () => {
    const answer: JsonTransaction = {
      blockTime: 1_791_770_124,
      transaction: { message: { accountKeys: [fake, vault], header: { numRequiredSignatures: 1 } } },
      meta: {
        preBalances: [10_000, 0, 7],
        postBalances: [4_950, 1_000, 7],
        loadedAddresses: { writable: [], readonly: [spammer] },
        preTokenBalances: [{ owner: vault, mint, uiTokenAmount: { amount: "3" } }],
        postTokenBalances: [{ owner: vault, mint, uiTokenAmount: { amount: "5" } }],
      },
    };
    expect(movementOf(sig("3"), answer)).toEqual({
      signature: sig("3"),
      time: 1_791_770_124,
      keys: [fake, vault, spammer],
      signers: 1,
      sol: [
        { pre: 10_000n, post: 4_950n },
        { pre: 0n, post: 1_000n },
        { pre: 7n, post: 7n },
      ],
      tokens: [{ owner: vault, mint, pre: 3n, post: 5n }],
    });
    // An answer that does not add up is left out, never guessed at.
    expect(movementOf(sig("3"), { ...answer, meta: { ...answer.meta!, postBalances: [1] } })).toBeNull();
    expect(movementOf(sig("3"), { ...answer, meta: null })).toBeNull();
    expect(movementOf(sig("3"), null)).toBeNull();
  });
});
