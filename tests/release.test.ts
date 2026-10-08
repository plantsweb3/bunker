import { describe, it, expect } from "vitest";
import { configFromEnv, MAINNET_GENESIS, DEVNET_GENESIS } from "../lib/bunker-config";
import { transition } from "../sdk/demo";
import { assertNetwork } from "../sdk/client";
import type { Connection } from "@solana/web3.js";
describe("Release gate", () => {
  it("pins full RPC genesis hashes and accepts a mainnet read", async () => {
    expect(MAINNET_GENESIS).toBe("5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d");
    expect(DEVNET_GENESIS).toBe("EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG");
    await expect(assertNetwork({ getGenesisHash: async () => MAINNET_GENESIS } as Connection, configFromEnv({}))).resolves.toBeUndefined();
    await expect(assertNetwork({ getGenesisHash: async () => MAINNET_GENESIS.slice(0, 32) } as Connection, configFromEnv({}))).rejects.toThrow("pinned network");
  });
  it("defaults to read-only mainnet", () => {
    expect(configFromEnv({})).toMatchObject({
      network: "mainnet-beta",
      custodyEnabled: false,
      programId: null,
    });
  });
  it.each(["mainnet", "mainnet-beta", "production", ""])(
    "cannot enable mainnet with mode %s",
    (mode) => {
      expect(
        configFromEnv({
          BUNKER_ENABLE_TEST_CUSTODY: "true",
          BUNKER_TEST_NETWORK: mode,
          BUNKER_TEST_PROGRAM_ID: "k7FaK87WHGVXzkaoHb7CdVPgkKDQhZ29VLDeBVbDfYn",
        }).custodyEnabled,
      ).toBe(false);
    },
  );
  it("stays off when the program id is not an address", () => {
    for (const id of ["test", "", "https://evil.example/x", "k7FaK87W HGVXzkaoHb7CdVPgkKDQhZ29VLDeBVbDfYn"])
      expect(
        configFromEnv({ BUNKER_ENABLE_TEST_CUSTODY: "true", BUNKER_TEST_NETWORK: "devnet", BUNKER_TEST_PROGRAM_ID: id }).custodyEnabled,
        id,
      ).toBe(false);
  });
  it("requires explicit test opt-in and program", () => {
    expect(
      configFromEnv({ BUNKER_TEST_NETWORK: "devnet" }).custodyEnabled,
    ).toBe(false);
  });
  it("rejects a mainnet RPC even if a caller supplies a forged test config", async () => {
    const c = { getGenesisHash: async () => MAINNET_GENESIS } as Connection;
    const config = {
      ...configFromEnv({}),
      custodyEnabled: true,
      network: "devnet" as const,
      programId: "test",
    };
    await expect(assertNetwork(c, config, true)).rejects.toThrow(
      "Mainnet custody",
    );
  });
});
describe("Simulation states", () => {
  it("runs the full educational sequence", () => {
    let s = transition("wallet", "deposit");
    s = transition(s, "compromise");
    s = transition(s, "attack");
    expect(s).toBe("rejected");
    expect(transition(s, "withdraw")).toBe("withdrawn");
  });
  it("rejects skipped steps and resets", () => {
    expect(() => transition("wallet", "withdraw")).toThrow();
    expect(transition("withdrawn", "reset")).toBe("wallet");
  });
});
