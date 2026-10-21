/** The completed audit, in one place. Everything the site says about it
 * links here, so a change of wording or link is made once. */
export const AUDIT = {
  by: "CertiK",
  /** CertiK's public page for the project, with the report. */
  url: "https://skynet.certik.com/projects/bunker-mode",
  published: "20 October 2026",
  /** What was reviewed: the on-chain program and its signature verifier. */
  commit: "f6a37ce",
  summary: "No critical, high or medium issues. Of its four findings, three are resolved and one is acknowledged.",
} as const;
