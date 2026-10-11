import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const build = () => execFileSync(process.execPath, ["scripts/build-extension.mjs"], { encoding: "utf8" });
const zip = () => readFileSync("public/source/bunker-watch.zip");
/** The names in a zip, read from its central directory. */
function names(archive: Buffer) {
  const found: string[] = [];
  for (let at = archive.indexOf(Buffer.from("PK\x01\x02", "latin1")); at >= 0; at = archive.indexOf(Buffer.from("PK\x01\x02", "latin1"), at + 46)) {
    const length = archive.readUInt16LE(at + 28);
    found.push(archive.subarray(at + 46, at + 46 + length).toString("utf8"));
    // Stored, never compressed: the bytes cannot depend on a compression library.
    expect(archive.readUInt16LE(at + 10)).toBe(0);
  }
  return found;
}

describe("Bunker Watch: the published build", () => {
  it("is the same zip, byte for byte, when built twice", () => {
    build();
    const first = zip();
    build();
    expect(zip().equals(first)).toBe(true);
    const record = JSON.parse(readFileSync("public/source/extension-manifest.json", "utf8"));
    expect(record.sha256).toBe(createHash("sha256").update(first).digest("hex"));
    expect(record.bytes).toBe(first.length);
    // The one official listing, as extension/store.json names it.
    expect(record.storeItemId).toBe("hdolgpohfdllibcmceaenliegnedeafn");
    // Each file's own hash is published too, for checking a copy a store has repackaged.
    expect(record.files.map((f: { path: string }) => f.path)).toEqual(names(first));
    for (const f of record.files)
      expect(f.sha256).toBe(createHash("sha256").update(readFileSync(`dist/bunker-watch/${f.path}`)).digest("hex"));
  }, 60_000);
  it("asks the browser for storage, alarms and notifications, and nothing else", () => {
    const manifest = JSON.parse(readFileSync("dist/bunker-watch/manifest.json", "utf8"));
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(["storage", "alarms", "notifications"]);
    // The default endpoint; any other is asked for one origin at a time, when the user sets it.
    expect(manifest.host_permissions).toEqual(["https://api.mainnet-beta.solana.com/*"]);
    expect(manifest.optional_host_permissions).toEqual(["https://*/*"]);
    // Its own code, styles, fonts and pictures only; the network only over https; nothing else at all.
    expect(manifest.content_security_policy.extension_pages).toBe(
      "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src https:; object-src 'none'",
    );
    for (const never of ["content_scripts", "externally_connectable", "web_accessible_resources", "optional_permissions"])
      expect(manifest[never], never).toBeUndefined();
    expect(JSON.stringify(manifest)).not.toMatch(/all_urls|"tabs"|scripting|http:\/\//);
  });
  it("holds its own code, fonts with their licences, and icons, and fetches no code", () => {
    const files = names(zip());
    expect(files).toEqual([...files].sort());
    // Nothing but what the build names: no notes, no stray files.
    expect(files.filter((f) => !/^(manifest\.json|background\.js|popup\.(js|html|css)|icons\/\d+\.png|fonts\/[\w-]+\.(woff2|ttf|txt)|kit\/watch-(empty|quiet)\.jpg)$/.test(f))).toEqual([]);
    expect(files).toEqual(
      expect.arrayContaining(["manifest.json", "background.js", "popup.js", "popup.html", "popup.css", "icons/128.png", "fonts/inter-OFL.txt", "fonts/jetbrainsmono-OFL.txt", "fonts/spacegrotesk-OFL.txt"]),
    );
    const html = readFileSync("dist/bunker-watch/popup.html", "utf8");
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/<script(?![^>]*src="popup\.js")/);
    const css = readFileSync("dist/bunker-watch/popup.css", "utf8");
    expect(css).not.toMatch(/url\(["']?https?:/);
    // The colours are the site's, taken from its one token file.
    expect(css).toContain("--bm-ice: #A9DEFF");
  });
  it("can be given no network but mainnet, and has no key handling in it", () => {
    for (const file of ["background.js", "popup.js"]) {
      const code = readFileSync(`dist/bunker-watch/${file}`, "utf8");
      expect(code).not.toContain("__BUNKER_WATCH_TEST__");
      expect(code).toContain("DGXACBwbUqRKRVR1TQojZBoRuV2TZJ8wVnQSuLKm2nJJ");
      expect(code).toContain("5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d");
      // None of the code that opens key files, signs or keeps the signing journal is in the build.
      for (const secret of ["decryptDayKey", "decryptArchival", "authorizeAnnouncement", "signAnnouncement", "BUNKER-KDF", "scrypt"])
        expect(code.includes(secret), `${file} contains ${secret}`).toBe(false);
    }
  });
});
