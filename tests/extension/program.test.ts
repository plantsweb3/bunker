import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { authorityOf, programDataOf, UPGRADEABLE_LOADER } from "../../extension/src/program";

const data = new PublicKey("Ga1huSvpvaKFg7jiZnRoL89154MbypVdgBQ516UkCV1k");
const key = "Ci5cG8d6MvU5ykKkQhN3LHnPN2VCmwZuotRNLqA9SYth";
const program = () => {
  const d = new Uint8Array(36);
  new DataView(d.buffer).setUint32(0, 2, true);
  d.set(data.toBytes(), 4);
  return d;
};
const header = (authority: string | null, tag = authority ? 1 : 0) => {
  const d = new Uint8Array(45);
  new DataView(d.buffer).setUint32(0, 3, true);
  d[12] = tag;
  if (authority) d.set(new PublicKey(authority).toBytes(), 13);
  return d;
};

describe("Bunker Watch: whether the program can be changed", () => {
  it("finds the program-data account a program names", () => {
    expect(programDataOf(UPGRADEABLE_LOADER, program()).toBase58()).toBe(data.toBase58());
  });
  it("reads nobody, or the address that can upgrade", () => {
    expect(authorityOf(UPGRADEABLE_LOADER, header(null))).toBeNull();
    expect(authorityOf(UPGRADEABLE_LOADER, header(key))).toBe(key);
  });
  it("refuses anything that is not the upgradeable loader's own layout, rather than guess", () => {
    expect(() => programDataOf("11111111111111111111111111111111", program())).toThrow();
    expect(() => programDataOf(UPGRADEABLE_LOADER, program().subarray(0, 20))).toThrow();
    expect(() => authorityOf(UPGRADEABLE_LOADER, program())).toThrow();
    expect(() => authorityOf(UPGRADEABLE_LOADER, header(null, 2))).toThrow();
    expect(() => authorityOf("11111111111111111111111111111111", header(null))).toThrow();
  });
});
