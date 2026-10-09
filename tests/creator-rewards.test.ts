import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { rewardAccountsOf } from "../lib/creator-reward-accounts";
import { curveRewards, exchangeRewards, SYSTEM_PROGRAM, TOKEN_PROGRAM, WRAPPED_SOL, type RawAccount } from "../lib/creator-rewards";

const wallet = "4pJr11CZC8Edyjoe2A93G2myNorjVeq2o4zWHXyPqrYC";
const accounts = rewardAccountsOf(wallet);
const RENT = 650_240;
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
/** A classic token account holding `amount` of `mint` for `owner`. */
function tokenAccount(mint: string, owner: string, amount: bigint): NonNullable<RawAccount> {
  const data = new Uint8Array(165);
  data.set(new PublicKey(mint).toBytes(), 0);
  data.set(new PublicKey(owner).toBytes(), 32);
  new DataView(data.buffer).setBigUint64(64, amount, true);
  return { lamports: 2_039_280 + Number(amount), owner: TOKEN_PROGRAM, data: [b64(data), "base64"] };
}
const plain = (lamports: number): NonNullable<RawAccount> => ({ lamports, owner: SYSTEM_PROGRAM, data: ["", "base64"] });

describe("Unclaimed creator rewards", () => {
  it("derives the accounts that were observed on chain for the bounty wallet", () => {
    expect(accounts).toEqual({
      curveVault: "HpWPu79ZPjtNR5pNm9cynV9j2aqYWXi2CaLPbazn2MRk",
      exchangeVault: "8Fj5a3PWXZbjVEXnaf2Kc4hwc93FXqLomrwZAXFLmRRQ",
      exchangeAuthority: "CsnKcYYurKieDpiwp1FujMRPsghH98a6AL3JQ5Qa3aBQ",
    });
  });
  it("counts what the curve vault holds above the minimum, and nothing for a missing one", () => {
    expect(curveRewards(null, RENT)).toBe(0);
    expect(curveRewards(plain(RENT), RENT)).toBe(0);
    expect(curveRewards(plain(RENT + 5_000_000), RENT)).toBe(5_000_000);
    expect(curveRewards(plain(10), RENT)).toBe(0);
  });
  it("counts the wrapped SOL in the exchange vault, not its rent", () => {
    expect(exchangeRewards(null, accounts)).toBe(0);
    expect(exchangeRewards(tokenAccount(WRAPPED_SOL, accounts.exchangeAuthority, 116_224_177n), accounts)).toBe(116_224_177);
  });
  it("calls anything unexpected unknown instead of guessing", () => {
    const good = tokenAccount(WRAPPED_SOL, accounts.exchangeAuthority, 1n);
    // Another token, another owner, another program, a different size, another encoding.
    expect(exchangeRewards(tokenAccount(wallet, accounts.exchangeAuthority, 1n), accounts)).toBeNull();
    expect(exchangeRewards(tokenAccount(WRAPPED_SOL, wallet, 1n), accounts)).toBeNull();
    expect(exchangeRewards({ ...good, owner: SYSTEM_PROGRAM }, accounts)).toBeNull();
    expect(exchangeRewards({ ...good, data: [b64(new Uint8Array(82)), "base64"] }, accounts)).toBeNull();
    expect(exchangeRewards({ ...good, data: [good.data[0], "base58"] }, accounts)).toBeNull();
    expect(exchangeRewards(tokenAccount(WRAPPED_SOL, accounts.exchangeAuthority, 2n ** 60n), accounts)).toBeNull();
    expect(curveRewards({ ...plain(RENT + 1), owner: TOKEN_PROGRAM }, RENT)).toBeNull();
    expect(curveRewards({ lamports: RENT + 1, owner: SYSTEM_PROGRAM, data: [b64(new Uint8Array(8)), "base64"] }, RENT)).toBeNull();
  });
});
