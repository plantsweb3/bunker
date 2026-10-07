# Third-party provenance

- **Winterwallet core:** `crates/winterwallet-core` is the MIT-licensed Blueshift Winterwallet core by Dean Little, sourced from commit `672fc6789b1532ee680f24842d235e0be8737b61`. Its license is preserved alongside the source. The TypeScript adapter implements that N32 SHA-256 construction and is checked against a Rust-generated vector. It is not a claim of standards compliance, independent audit, or upstream endorsement. See `docs/CRYPTOGRAPHY.md`.
- **Solana libraries:** official `@solana/web3.js`, `@solana/kit`, and `@solana-program/token` supply network, account, and classic-token instruction primitives. Bunker does not implement a replacement token program.
- **Web stack:** Next.js, React, Radix UI, Lucide, Tailwind, Noble Hashes, and other dependencies retain their upstream package licenses. The copied shadcn stylesheet's MIT notice is in `vendor/shadcn-tailwind-4.13.0.LICENSE.md`.
- **Fonts:** self-hosted Inter and Space Grotesk via Fontsource. Their packages include the SIL Open Font License.
- **Brand:** the Bunker brand kit was supplied by the project owner. See `docs/brand` for the supplied palette and asset manifest. Brand marks do not imply affiliation with the upstream software projects.
- **Architecture imagery:** see `docs/IMAGE-PROVENANCE.txt`. Imagery illustrates the identity; it does not depict a physical custody facility.

The root MIT license applies to Bunker's source. Third-party notices and license terms remain applicable. No contributor or reviewer endorsement should be inferred from dependency use.
