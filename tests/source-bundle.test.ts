import { it, expect } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
it("source archives exclude key files and exchanged files", () => {
  const dir = mkdtempSync(join(tmpdir(), "bunker-source-test-"));
  try {
    writeFileSync(join(dir, "README.md"), "Public source fixture");
    // Files nobody listed are not published, whatever they are called.
    writeFileSync(join(dir, "wallet.json"), "DO NOT PUBLISH");
    writeFileSync(join(dir, "notes.txt"), "DO NOT PUBLISH");
    mkdirSync(join(dir, "downloads"));
    writeFileSync(join(dir, "downloads", "my-kit.json"), "DO NOT PUBLISH");
    for (const name of [
      "bunker-test-RECOVERY-KIT-7ayn5V2r.json",
      "bunker-test-day-key-7ayn5V2r-epoch-0.json",
      "bunker-test-creation-request-7ayn5V2r.json",
      "bunker-test-recovery-packet-7ayn5V2r-epoch-0.json",
      "bunker-test-network-card-localnet.json",
      "bunker-devnet-public-0.json",
      "test.recovery.json",
      ".env.local",
      "shot.tmp.mjs",
    ])
      writeFileSync(join(dir, name), "DO NOT PUBLISH");
    const build = spawnSync(
      process.execPath,
      [resolve("scripts/bundle-source.mjs")],
      { cwd: dir, encoding: "utf8" },
    );
    expect(build.status, build.stderr).toBe(0);
    const manifest = JSON.parse(
      readFileSync(join(dir, "public/source/source-manifest.json"), "utf8"),
    );
    expect(manifest.files.map((f: { path: string }) => f.path)).toEqual([
      "README.md",
    ]);
    const archive = spawnSync(
      "tar",
      ["-tzf", join(dir, "public/source/bunker-source.tar.gz")],
      { encoding: "utf8" },
    );
    expect(archive.status).toBe(0);
    expect(archive.stdout.trim()).toBe("README.md");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
it("stops, rather than skips, when key material sits inside a published directory", () => {
  for (const name of [
    "bunker-test-RECOVERY-KIT-7ayn5V2r.json",
    "deploy-keypair.json",
    "id.json",
    ".env.production",
    "signer.pem",
    "keypair.json",
    "mainnet_keypair_backup.json",
    "cert.p12",
    "id_ed25519",
    "my-RECOVERY-KIT-copy.json",
    "old-day-key.json",
    ".npmrc",
  ]) {
    const dir = mkdtempSync(join(tmpdir(), "bunker-source-test-"));
    try {
      mkdirSync(join(dir, "docs"));
      writeFileSync(join(dir, "docs", name), "DO NOT PUBLISH");
      const build = spawnSync(process.execPath, [resolve("scripts/bundle-source.mjs")], { cwd: dir, encoding: "utf8" });
      expect(build.status, name).not.toBe(0);
      expect(build.stderr, name).toContain("Refusing to publish");
      expect(build.stderr, name).toContain(`docs/${name}`);
      expect(existsSync(join(dir, "public/source/bunker-source.tar.gz")), name).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const dir = mkdtempSync(join(tmpdir(), "bunker-source-test-"));
  try {
    writeFileSync(join(dir, ".npmrc"), "//registry.npmjs.org/:_authToken=abc\n");
    const build = spawnSync(process.execPath, [resolve("scripts/bundle-source.mjs")], { cwd: dir, encoding: "utf8" });
    expect(build.status).not.toBe(0);
    expect(build.stderr).toContain("registry credentials");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
it("publishes exactly the files Git tracks or would track", () => {
  if (!existsSync(".git")) return; // An exported archive has no repository to compare with.
  const tracked = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" });
  expect(tracked.status).toBe(0);
  const listed = spawnSync(process.execPath, ["scripts/bundle-source.mjs", "--list"], { encoding: "utf8" });
  expect(listed.status, listed.stderr).toBe(0);
  const lines = (out: string) => out.trim().split("\n").sort();
  expect(lines(listed.stdout)).toEqual(lines(tracked.stdout));
});
