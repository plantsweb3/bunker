import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";
import { hex, unhex } from "../sdk/bytes";
import { address, base58, programAddress, recoverMessageBytes, vaultAddressBytes } from "../sdk/v3/core";
import { proofAddress, recoverMessage, spentAddress, vaultAddress } from "../sdk/v3/protocol";

/** `sdk/v3/core.ts` derives addresses with no Solana library, for the offline
 * tool. Here it is held against `@solana/web3.js`, an independent
 * implementation, on fixed and pseudo-random inputs. */
const fixture = JSON.parse(readFileSync("fixtures/bunker-v3.json", "utf8"));
let state = 0x9e3779b9;
const next = () => {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return state >>> 0;
};
const random32 = () => Uint8Array.from({ length: 32 }, () => next() & 0xff);

describe("Addresses without a Solana library", () => {
  it("encodes and decodes base58 exactly as the Solana library does", () => {
    const cases = [
      new Uint8Array(32),
      new Uint8Array(32).fill(255),
      Uint8Array.from({ length: 32 }, (_, i) => (i < 5 ? 0 : i)),
      ...Array.from({ length: 300 }, random32),
    ];
    for (const bytes of cases) {
      const expected = new PublicKey(bytes).toBase58();
      expect(base58(bytes)).toBe(expected);
      expect(hex(address(expected))).toBe(hex(bytes));
    }
  });
  it("rejects anything that is not exactly one 32-byte address", () => {
    const good = new PublicKey(random32()).toBase58();
    for (const bad of [
      "",
      "abc",
      good + "1",
      "1" + good, // an extra leading zero byte: 33 bytes
      good.replace(/.$/, "0"), // not in the alphabet
      good.replace(/.$/, "l"),
      "z".repeat(44), // larger than 32 bytes
      " " + good,
    ]) {
      expect(() => address(bad), bad).toThrow("Invalid address");
      // The Solana library refuses each of these too.
      expect(() => new PublicKey(bad), bad).toThrow();
    }
    // And whatever the Solana library accepts as an address, this accepts as the same bytes.
    for (let i = 0; i < 200; i++) {
      const shorter = new PublicKey(random32()).toBase58().slice(1);
      let theirs: string | null = null;
      try {
        theirs = hex(new PublicKey(shorter).toBytes());
      } catch {
        theirs = null;
      }
      let ours: string | null = null;
      try {
        ours = hex(address(shorter));
      } catch {
        ours = null;
      }
      expect(ours, shorter).toBe(theirs);
    }
  });
  it("derives the same program addresses, including the bump search", () => {
    const program = new PublicKey(fixture.program);
    expect(base58(vaultAddressBytes(program.toBytes(), unhex(fixture.vaultId)))).toBe(fixture.vault);
    let lowBumps = 0;
    for (let i = 0; i < 400; i++) {
      const programId = new PublicKey(random32());
      const id = random32();
      const [expected, bump] = PublicKey.findProgramAddressSync([Buffer.from("bunker3"), id], programId);
      if (bump < 255) lowBumps++;
      expect(base58(vaultAddressBytes(programId.toBytes(), id))).toBe(expected.toBase58());
      expect(vaultAddress(programId, id).toBase58()).toBe(expected.toBase58());
      // The other two address families, through the general function.
      const vault = expected;
      expect(base58(programAddress([new TextEncoder().encode("spent-v3"), vault.toBytes(), id], programId.toBytes()))).toBe(
        spentAddress(programId, vault, id).toBase58(),
      );
      expect(base58(programAddress([new TextEncoder().encode("proof"), vault.toBytes(), id], programId.toBytes()))).toBe(
        proofAddress(programId, vault, id).toBase58(),
      );
    }
    // About half of all seeds need a second bump: the search path was exercised.
    expect(lowBumps).toBeGreaterThan(100);
  });
  it("builds the recovery message byte for byte as the client library does", () => {
    const program = new PublicKey(fixture.program);
    const payload = unhex(fixture.recover.payload);
    expect(hex(recoverMessageBytes(program.toBytes(), payload))).toBe(fixture.recover.message);
    expect(hex(recoverMessage(program, payload))).toBe(fixture.recover.message);
  });
});
