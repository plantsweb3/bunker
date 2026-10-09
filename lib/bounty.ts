/** The bug bounty's terms, in one place. Change a payout here and nowhere
 * else. "TBD" means not set yet; the page prints it as written. */
export const REPORT_URL = "https://github.com/plantsweb3/bunker/security/advisories/new";
export type Tier = { name: "Critical" | "High" | "Medium" | "Low"; payout: string; means: string; examples: string[] };
export const TIERS: Tier[] = [
  {
    name: "Critical",
    payout: "TBD",
    means: "Funds leave a Bunker without its owner’s keys, or its rules are bypassed.",
    examples: [
      "Withdraw from a Bunker you don’t control.",
      "Reuse or forge a one-time-key signature.",
      "Bypass the trusted addresses or the waiting period.",
      "Read a recovery kit’s secret out of the offline tool.",
    ],
  },
  {
    name: "High",
    payout: "TBD",
    means: "An owner loses control of a Bunker, or signs something they did not see.",
    examples: [
      "Lock a Bunker’s funds so its owner can never withdraw them.",
      "Make the site, the offline tool or the command-line client sign something other than what it showed.",
      "Take a day key or its password out of the site, for example by running your own script on bunkermode.io.",
      "Cancel or block someone else’s withdrawal or recovery.",
    ],
  },
  {
    name: "Medium",
    payout: "TBD",
    means: "A Bunker is disrupted or misreported, and no funds move.",
    examples: [
      "Stop one Bunker from working for a while.",
      "Make an alert miss a withdrawal, or report one that did not happen.",
      "Show a wrong balance or a wrong state that could lead an owner to a bad decision.",
    ],
  },
  {
    name: "Low",
    payout: "TBD",
    means: "A real flaw with no path to anyone’s funds.",
    examples: [
      "A gap in the page’s security policy that cannot be used yet.",
      "A check that is weaker than the documentation says.",
      "Wording that would mislead a careful reader about what is protected.",
    ],
  },
];
/** People who reported something that was confirmed and fixed. */
export const HALL_OF_FAME: { name: string; found: string; fixedIn: string }[] = [];
