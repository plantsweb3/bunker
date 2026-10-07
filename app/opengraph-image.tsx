import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
export const alt = "Bunker — One bad signature shouldn’t cost you everything.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
const read = (path: string) =>
  readFile(join(process.cwd(), path)).catch(() => null);
export default async function Image() {
  const [mark, grotesk] = await Promise.all([
    read("public/brand/bunker-icon-stone.svg"),
    read(
      "node_modules/@fontsource/space-grotesk/files/space-grotesk-latin-500-normal.woff",
    ),
  ]);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background:
            "radial-gradient(ellipse at 85% 0%, #1b2c32 0%, #0a0a0a 62%)",
          color: "#f5f7f6",
          fontFamily: grotesk ? "Space Grotesk" : "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          {mark && (
            <img
              alt=""
              width={52}
              height={52}
              src={`data:image/svg+xml;base64,${mark.toString("base64")}`}
            />
          )}
          <div style={{ fontSize: 34, letterSpacing: 14 }}>BUNKER</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 22, letterSpacing: 5, color: "#7dd3c7" }}>
            PREPARE. DON’T PANIC.
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              marginTop: 22,
              fontSize: 82,
              lineHeight: 1.06,
              letterSpacing: -3,
            }}
          >
            <span>One bad signature</span>
            <span>shouldn’t cost you</span>
            <span style={{ color: "#b5ced2" }}>everything.</span>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 22,
            color: "#9ca3af",
          }}
        >
          <span>A separate vault for the Solana you can’t afford to lose.</span>
          <span style={{ color: "#bdd3d6" }}>bunkermode.io</span>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: grotesk
        ? [{ name: "Space Grotesk", data: grotesk, weight: 500, style: "normal" }]
        : undefined,
    },
  );
}
