import { describe, expect, it } from "vitest";
import { launchFromEnv } from "../lib/launch-config";
import { HALL_OF_FAME, REPORT_URL, TIERS } from "../lib/bounty";

describe("Launch addresses", () => {
  it("shows nothing until an address is set", () => {
    expect(launchFromEnv({})).toEqual({ coinAddress: null, bountyWallet: null });
  });
  it("accepts a Solana address and nothing else", () => {
    const wallet = "Ci5cG8d6MvU5ykKkQhN3LHnPN2VCmwZuotRNLqA9SYth";
    const live = { BUNKER_LAUNCH_LIVE: "true" };
    expect(launchFromEnv({ ...live, BOUNTY_WALLET_ADDRESS: wallet, BUNKER_COIN_ADDRESS: wallet })).toEqual({
      coinAddress: wallet,
      bountyWallet: wallet,
    });
    for (const bad of ["", "TBD", "coming soon", "https://pump.fun/coin/x", `${wallet} `, "0x7ce70FF1", "<script>"])
      expect(launchFromEnv({ ...live, BOUNTY_WALLET_ADDRESS: bad, BUNKER_COIN_ADDRESS: bad }), bad).toEqual({
        coinAddress: null,
        bountyWallet: null,
      });
  });
});
describe("Addresses staged before launch", () => {
  it("stay hidden until the launch switch is exactly \"true\"", () => {
    const staged = {
      BOUNTY_WALLET_ADDRESS: "Ci5cG8d6MvU5ykKkQhN3LHnPN2VCmwZuotRNLqA9SYth",
      BUNKER_COIN_ADDRESS: "Ci5cG8d6MvU5ykKkQhN3LHnPN2VCmwZuotRNLqA9SYth",
    };
    for (const flag of [undefined, "", "false", "1", "TRUE", "yes", "true "])
      expect(launchFromEnv({ ...staged, BUNKER_LAUNCH_LIVE: flag }), String(flag)).toEqual({
        coinAddress: null,
        bountyWallet: null,
      });
  });
});
describe("Bounty terms", () => {
  it("names four tiers and invents no amounts", () => {
    expect(TIERS.map((t) => t.name)).toEqual(["Critical", "High", "Medium", "Low"]);
    // An amount is either unset or a figure someone chose to write down here.
    for (const t of TIERS) expect(t.payout === "TBD" || /\d/.test(t.payout), t.name).toBe(true);
    expect(Array.isArray(HALL_OF_FAME)).toBe(true);
  });
  it("sends reports to the private channel", () => {
    expect(REPORT_URL).toBe("https://github.com/plantsweb3/bunker/security/advisories/new");
  });
});
