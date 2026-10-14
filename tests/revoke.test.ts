import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { getRevokeInstruction } from "@solana-program/token";
import { address, createNoopSigner } from "@solana/kit";
import { revokeIx } from "../lib/revoke";

const owner = new PublicKey("4pJr11CZC8Edyjoe2A93G2myNorjVeq2o4zWHXyPqrYC");
const account = "8Fj5a3PWXZbjVEXnaf2Kc4hwc93FXqLomrwZAXFLmRRQ";

describe("Revoking an approval", () => {
  it("is exactly the token program's own Revoke instruction", () => {
    const ours = revokeIx(account, owner, "classic");
    const theirs = getRevokeInstruction({ source: address(account), owner: createNoopSigner(address(owner.toBase58())) });
    expect(ours.programId.toBase58()).toBe(theirs.programAddress);
    expect([...ours.data]).toEqual([...theirs.data]);
    expect(ours.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable])).toEqual([
      [account, false, true],
      [owner.toBase58(), true, false],
    ]);
  });
  it("goes to Token-2022 for a Token-2022 account, with the same one byte", () => {
    const ix = revokeIx(account, owner, "token-2022");
    expect(ix.programId.toBase58()).toBe("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
    expect([...ix.data]).toEqual([5]);
  });
});
