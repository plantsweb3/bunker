import type { NextConfig } from "next";

const LOCKED_POLICY =
  "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
/** Every path the proxy's matcher leaves out. Keep in step with proxy.ts. */
const UNPROXIED = [
  "/api/:path*",
  "/_next/:path*",
  "/brand/:path*",
  "/assets/:path*",
  "/favicon.ico",
  "/sitemap.xml",
  "/robots.txt",
  "/(.*opengraph-image.*)",
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    // Pages get a per-request policy with a nonce from proxy.ts. These paths do
    // not pass through it, so anything they return (a not-found page included)
    // gets a fixed policy that runs nothing and loads nothing.
    const locked = [
      { key: "Content-Security-Policy", value: LOCKED_POLICY },
    ];
    return [
      { source: "/(.*)", headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ] },
      ...UNPROXIED.map((source) => ({ source, headers: locked })),
      // The recovery tool and anything else under /source is for download. It
      // must never run with this site's origin.
      { source: "/source/:path*", headers: [
        { key: "Content-Security-Policy", value: `${LOCKED_POLICY}; sandbox` },
        { key: "Content-Disposition", value: "attachment" },
      ] },
    ];
  },
};

export default nextConfig;
