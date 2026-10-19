// Builds Bunker Watch, the read-only browser extension, into one zip file.
// The same source gives the same zip, byte for byte: files are added in a
// fixed order with a fixed date and are stored, not compressed, so the result
// does not depend on the machine or on a compression library's version. The
// zip is not committed; its SHA-256 is published next to it and CI builds it
// twice and compares.
//
//   node scripts/build-extension.mjs          writes public/source/bunker-watch.zip,
//                                             public/source/extension-manifest.json and
//                                             the same files unpacked in dist/bunker-watch/
//   node scripts/build-extension.mjs --test   writes dist/bunker-watch-test/, a build
//                                             for a local validator. Never published.
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const test = process.argv.includes("--test");
const root = resolve(".");
const manifest = JSON.parse(await readFile("extension/manifest.json", "utf8"));
const store = JSON.parse(await readFile("extension/store.json", "utf8"));
if (store.chromeWebStoreItemId !== null && !/^[a-p]{32}$/.test(store.chromeWebStoreItemId))
  throw new Error("extension/store.json: a Chrome Web Store item id is 32 letters from a to p.");
let local = "undefined";
if (test) {
  // The values scripts/setup-local.ts wrote for the local validator.
  const env = Object.fromEntries(
    (await readFile(".env.local", "utf8")).split("\n").flatMap((l) => {
      const at = l.indexOf("=");
      return at > 0 && !l.startsWith("#") ? [[l.slice(0, at).trim(), l.slice(at + 1).trim()]] : [];
    }),
  );
  const rpc = env.BUNKER_TEST_RPC_URL ?? "http://127.0.0.1:19099";
  if (!env.BUNKER_TEST_PROGRAM_ID || !env.BUNKER_LOCAL_GENESIS) throw new Error("Run npm run setup:local first.");
  // A test build is for a validator on this computer and nothing else.
  if (!["127.0.0.1", "localhost"].includes(new URL(rpc).hostname)) throw new Error("A test build may only use a local validator.");
  local = JSON.stringify({ rpc, program: env.BUNKER_TEST_PROGRAM_ID, genesis: env.BUNKER_LOCAL_GENESIS });
  manifest.name = "Bunker Watch (LOCAL TEST BUILD)";
  manifest.host_permissions = [`${new URL(rpc).origin}/*`];
  manifest.optional_host_permissions = [];
  manifest.content_security_policy.extension_pages = manifest.content_security_policy.extension_pages.replace(
    "connect-src https:",
    `connect-src ${new URL(rpc).origin}`,
  );
}
// Exactly these files go in, and no others: a stray file in the checkout must
// not change what is published. Pictures from the watch kit are the two the
// popup knows how to show, when they exist.
const FONTS = [
  "JetBrainsMono-wght.ttf",
  "inter-OFL.txt",
  "inter-latin-500-normal.woff2",
  "inter-latin-800-normal.woff2",
  "jetbrainsmono-OFL.txt",
  "space-grotesk-latin-500-normal.woff2",
  "spacegrotesk-OFL.txt",
];
const ICONS = ["128.png", "16.png", "32.png", "48.png"];
const KIT = ["watch-empty.jpg", "watch-quiet.jpg"];
const kitPictures = (await readdir("extension/assets/kit")).filter((n) => KIT.includes(n)).sort();
const bundle = async (entry) => {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "chrome120",
    minify: false,
    legalComments: "none",
    write: false,
    alias: { "@": root },
    define: { __BUNKER_WATCH_TEST__: local, __BUNKER_WATCH_KIT__: JSON.stringify(kitPictures) },
    logLevel: "warning",
  });
  return result.outputFiles[0].contents;
};
// The colours and font roles are the site's and the films': one definition, in one file.
const tokens = await readFile("app/bunker-mode-tokens.css", "utf8");
const rootBlock = tokens.match(/:root \{[^}]*\}/)?.[0];
if (!rootBlock) throw new Error("app/bunker-mode-tokens.css has no :root block");
const files = new Map();
files.set("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2) + "\n"));
files.set("background.js", Buffer.from(await bundle("extension/src/background.ts")));
files.set("popup.js", Buffer.from(await bundle("extension/src/popup/popup.ts")));
files.set("popup.html", await readFile("extension/src/popup/popup.html"));
files.set("popup.css", Buffer.from(`${rootBlock}\n${await readFile("extension/src/popup/popup.css", "utf8")}`));
for (const [dir, list] of [["fonts", FONTS], ["icons", ICONS], ["kit", kitPictures]])
  for (const name of list) files.set(`${dir}/${name}`, await readFile(`extension/assets/${dir}/${name}`));
const names = [...files.keys()].sort();

if (test) {
  const out = "dist/bunker-watch-test";
  await rm(out, { recursive: true, force: true });
  for (const name of names) {
    await mkdir(resolve(out, name, ".."), { recursive: true });
    await writeFile(`${out}/${name}`, files.get(name));
  }
  console.log(`Bunker Watch, local test build: ${names.length} files in ${out}. Not for publishing.`);
} else {
  // Every address the browser will let a published build reach must be https.
  for (const host of [...manifest.host_permissions, ...manifest.optional_host_permissions])
    if (!host.startsWith("https://")) throw new Error(`A published build must not be allowed to reach ${host}.`);
  // The same files unpacked, for loading into a browser by hand and for the tests.
  await rm("dist/bunker-watch", { recursive: true, force: true });
  for (const name of names) {
    await mkdir(resolve("dist/bunker-watch", name, ".."), { recursive: true });
    await writeFile(`dist/bunker-watch/${name}`, files.get(name));
  }
  const zip = storedZip(names.map((name) => [name, files.get(name)]));
  const out = "public/source";
  await mkdir(out, { recursive: true });
  await writeFile(`${out}/bunker-watch.zip`, zip);
  const record = {
    format: 1,
    file: "bunker-watch.zip",
    name: manifest.name,
    version: manifest.version,
    bytes: zip.length,
    sha256: createHash("sha256").update(zip).digest("hex"),
    // A store repackages what it is given, so the zip's hash will not match an
    // installed copy. Each file's hash will: compare these with the files in
    // the browser's folder for the extension.
    files: names.map((name) => ({
      path: name,
      bytes: files.get(name).length,
      sha256: createHash("sha256").update(files.get(name)).digest("hex"),
    })),
    permissions: manifest.permissions,
    hostPermissions: manifest.host_permissions,
    optionalHostPermissions: manifest.optional_host_permissions,
    /** The Chrome Web Store item this is published as, from extension/store.json. Null until it is. */
    storeItemId: store.chromeWebStoreItemId,
    status: "Public beta. Read-only: holds no keys.",
  };
  await writeFile(`${out}/extension-manifest.json`, JSON.stringify(record, null, 2) + "\n");
  console.log(`Bunker Watch: ${record.bytes} bytes, sha256 ${record.sha256}`);
}

/** A zip archive with every file stored as it is, dated 1 January 1980. */
function storedZip(entries) {
  const table = new Uint32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (bytes) => {
    let c = 0xffffffff;
    for (const b of bytes) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const DATE = 0x0021;
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const path = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // names are UTF-8
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(path.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4); // version made by
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(0, 10);
    entry.writeUInt16LE(0, 12);
    entry.writeUInt16LE(DATE, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(path.length, 28);
    entry.writeUInt32LE(offset, 42);
    parts.push(local, path, data);
    central.push(entry, path);
    offset += local.length + path.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}
