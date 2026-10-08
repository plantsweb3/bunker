// Bundles the offline recovery tool into ONE self-contained HTML file with no
// external resources. The inline script is pinned in the page's own Content
// Security Policy by its SHA-256, and the whole file's hash is published next
// to it. Output is not committed; it is reproducible from this repository.
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const out = "public/source";
const result = await build({
  entryPoints: ["tools/recovery/main.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "none",
  write: false,
  define: { "process.env.NODE_ENV": '"production"', global: "globalThis" },
  logLevel: "warning",
});
const script = result.outputFiles[0].text.replaceAll("</script", "<\\/script");
const scriptHash = `sha256-${createHash("sha256").update(script).digest("base64")}`;
const template = await readFile("tools/recovery/template.html", "utf8");
const html = template.replace("__SCRIPT_HASH__", scriptHash).replace("__SCRIPT__", () => script);
if (html.includes("__SCRIPT")) throw new Error("Template placeholder left behind");
await mkdir(out, { recursive: true });
await writeFile(`${out}/bunker-recovery-tool.html`, html);
const manifest = {
  format: 1,
  file: "bunker-recovery-tool.html",
  bytes: Buffer.byteLength(html),
  sha256: createHash("sha256").update(html).digest("hex"),
  scriptCsp: scriptHash,
  status: "DRAFT. Test networks only. Not reviewed.",
};
await writeFile(`${out}/recovery-tool-manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
console.log(`Recovery tool: ${manifest.bytes} bytes, sha256 ${manifest.sha256}`);
