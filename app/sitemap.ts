import type { MetadataRoute } from "next";
const BASE = "https://bunkermode.io";
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    "",
    "/demo",
    "/check",
    "/bounty",
    "/integrate",
    "/emergency",
    "/docs",
    "/security",
    "/verify",
    "/vault",
    "/terms",
    "/privacy",
  ].map((path) => ({ url: `${BASE}${path}` }));
}
