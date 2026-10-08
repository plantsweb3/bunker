import { describe, it, expect } from "vitest";
import { PublicKey } from "@solana/web3.js";
import {
  parseProgramData,
  programDataAddress,
  trimmed,
  UPGRADEABLE_LOADER,
} from "../scripts/check-deployment";

const key = (n: number) => new PublicKey(new Uint8Array(32).fill(n));
function programData(authority: PublicKey | null, code: number[], padding = 0) {
  const d = new Uint8Array(45 + code.length + padding);
  const view = new DataView(d.buffer);
  view.setUint32(0, 3, true);
  view.setBigUint64(4, 77n, true);
  if (authority) {
    d[12] = 1;
    d.set(authority.toBytes(), 13);
  }
  d.set(code, 45);
  return d;
}

describe("Reading a deployed program", () => {
  it("finds the code account a program points to, and refuses anything else", () => {
    const d = new Uint8Array(36);
    new DataView(d.buffer).setUint32(0, 2, true);
    d.set(key(9).toBytes(), 4);
    expect(programDataAddress(UPGRADEABLE_LOADER, d).equals(key(9))).toBe(true);
    expect(() => programDataAddress(key(1), d)).toThrow("not the upgradeable loader");
    expect(() => programDataAddress(UPGRADEABLE_LOADER, d.slice(0, 35))).toThrow("Not a program account");
    const buffer = d.slice();
    new DataView(buffer.buffer).setUint32(0, 1, true);
    expect(() => programDataAddress(UPGRADEABLE_LOADER, buffer)).toThrow("Not a program account");
  });
  it("reads the upgrade authority, present or removed, and the code after the header", () => {
    const held = parseProgramData(UPGRADEABLE_LOADER, programData(key(5), [1, 2, 3]));
    expect([held.slot, held.authority?.toBase58(), Array.from(held.code)]).toEqual([77n, key(5).toBase58(), [1, 2, 3]]);
    const final = parseProgramData(UPGRADEABLE_LOADER, programData(null, [1, 2, 3]));
    expect(final.authority).toBeNull();
    expect(Array.from(final.code)).toEqual([1, 2, 3]);
    // An authority field left over under a cleared tag is not an authority.
    const stale = programData(key(5), [1]);
    stale[12] = 0;
    expect(parseProgramData(UPGRADEABLE_LOADER, stale).authority).toBeNull();
    const odd = programData(null, [1]);
    odd[12] = 2;
    expect(() => parseProgramData(UPGRADEABLE_LOADER, odd)).toThrow("Unreadable upgrade authority");
    expect(() => parseProgramData(key(1), programData(null, [1]))).toThrow("Not a program-data account");
    expect(() => parseProgramData(UPGRADEABLE_LOADER, new Uint8Array(44))).toThrow("Not a program-data account");
  });
  it("compares code without the zero padding an account is allocated with", () => {
    expect(Array.from(trimmed(new Uint8Array([1, 0, 2, 0, 0])))).toEqual([1, 0, 2]);
    expect(trimmed(new Uint8Array(4)).length).toBe(0);
    const padded = parseProgramData(UPGRADEABLE_LOADER, programData(null, [7, 0, 8], 100));
    expect(Array.from(trimmed(padded.code))).toEqual([7, 0, 8]);
  });
});
