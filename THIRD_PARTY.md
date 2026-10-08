# Third-party provenance

- **Signature scheme:** the one-time signature is LM-OTS as specified in RFC 8554 (McGrew, Curcio, Fluhrer; IRTF, April 2019), section 4. `crates/bunker-lmots` and `sdk/lmots.ts` were written for this project from that text; no third-party implementation is included. `fixtures/rfc8554-test-case-1.json` and `-2.json` reproduce values printed in the RFC's Appendix F. Bunker uses the one-time scheme on its own, outside the LMS system, so this is not a claim of standards compliance, independent audit, or endorsement by the RFC's authors. See `docs/CRYPTOGRAPHY.md`. (An earlier draft vendored the MIT-licensed Blueshift Winterwallet core by Dean Little; it has been removed.)
- **Solana libraries:** official `@solana/web3.js`, `@solana/kit`, and `@solana-program/token` supply network, account, and classic-token instruction primitives. Bunker does not implement a replacement token program.
- **Web stack:** Next.js, React, Radix UI, Lucide, Tailwind, Noble Hashes, and other dependencies retain their upstream package licenses. The copied shadcn stylesheet's MIT notice is in `vendor/shadcn-tailwind-4.13.0.LICENSE.md`.
- **Fonts:** self-hosted Inter and Space Grotesk via Fontsource. Their packages include the SIL Open Font License.
- **Brand:** the Bunker brand kit was supplied by the project owner. See `docs/brand` for the supplied palette and asset manifest. Brand marks do not imply affiliation with the upstream software projects.
- **Architecture imagery:** see `docs/IMAGE-PROVENANCE.txt`. Imagery illustrates the identity; it does not depict a physical custody facility.

The root MIT license applies to Bunker's source. Third-party notices and license terms remain applicable. No contributor or reviewer endorsement should be inferred from dependency use.
