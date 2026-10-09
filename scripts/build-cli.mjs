// Bundles the command-line client into ONE JavaScript file that runs with
// Node 22 and nothing else: no `npm install`, no repository checkout. It is
// what a user runs to withdraw or recover when the website is unavailable.
// Output is not committed; it is reproducible from this repository, and its
// SHA-256 is published next to it.
//
//   node scripts/build-cli.mjs      writes public/source/bunker-cli.mjs
//   node bunker-cli.mjs status --rpc URL --vault ADDRESS --program ID
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
const out = "public/source";
const result = await build({
  entryPoints: ["tools/cli/bunker.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  minify: false,
  legalComments: "none",
  write: false,
  // Some dependencies are CommonJS and call `require` for Node built-ins.
  banner: {
    js: [
      "#!/usr/bin/env node",
      "// Bunker command-line client (public beta, not audited). Built from",
      "// https://github.com/plantsweb3/bunker by scripts/build-cli.mjs.",
      'import { createRequire as __bunkerRequire } from "node:module";',
      "const require = __bunkerRequire(import.meta.url);",
    ].join("\n"),
  },
  logLevel: "warning",
});
const code = result.outputFiles[0].text;
await mkdir(out, { recursive: true });
await writeFile(`${out}/bunker-cli.mjs`, code);
const manifest = {
  format: 1,
  file: "bunker-cli.mjs",
  bytes: Buffer.byteLength(code),
  sha256: createHash("sha256").update(code).digest("hex"),
  runs: "node bunker-cli.mjs (Node 22 or later)",
  status: "Public beta. Not audited.",
};
await writeFile(`${out}/cli-manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
console.log(`Command-line client: ${manifest.bytes} bytes, sha256 ${manifest.sha256}`);
