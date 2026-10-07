import { it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
it("source archives exclude both generations of exported recovery blobs", () => {
  const dir = mkdtempSync(join(tmpdir(), "bunker-source-test-"));
  try {
    writeFileSync(join(dir, "README.md"), "Public source fixture");
    for (const name of [
      "bunker-test-v2-public-0.json",
      "bunker-test-v2-public-0-pending.json",
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
