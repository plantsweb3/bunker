"use client";
// What the site publishes about the Bunker Watch build it serves: the file,
// its SHA-256 and, once there is one, its Chrome Web Store item. Read from the
// manifest written by scripts/build-extension.mjs, so the page cannot say
// something different from what was built.
import { useEffect, useState } from "react";

type Build = { file: string; version: string; bytes: number; sha256: string; storeItemId: string | null };
export default function ExtensionBuild() {
  const [build, setBuild] = useState<Build | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    fetch("/source/extension-manifest.json")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((b: Build) => (/^[0-9a-f]{64}$/.test(b.sha256) ? setBuild(b) : setMissing(true)))
      .catch(() => setMissing(true));
  }, []);
  if (missing) return <p className="notice">This deployment is not serving a build of the extension.</p>;
  if (!build) return <p>Reading the published build…</p>;
  return (
    <div className="panel extension-build">
      <div className="metric">
        <span>File</span>
        <b>
          <a href={`/source/${build.file}`} download>
            {build.file}
          </a>{" "}
          · version {build.version} · {build.bytes.toLocaleString("en-US")} bytes
        </b>
      </div>
      <div className="metric">
        <span>SHA-256</span>
        <b className="address">{build.sha256}</b>
      </div>
      <div className="metric">
        <span>Chrome Web Store item</span>
        <b className="address">
          {build.storeItemId ? (
            <a href={`https://chromewebstore.google.com/detail/${build.storeItemId}`} target="_blank" rel="noreferrer">
              {build.storeItemId}
            </a>
          ) : (
            "Not in the store yet. Any listing you find is not ours."
          )}
        </b>
      </div>
    </div>
  );
}
