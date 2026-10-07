import type { Metadata } from "next";
import "./globals.css";
// A fresh CSP nonce is required for each document response.
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: {
    default: "Bunker — A quieter place for your Solana",
    template: "%s | Bunker",
  },
  description:
    "Experimental Solana custody with independent hash-based authorization. Explore the demo, inspect the source, and understand the limits.",
  metadataBase: new URL("https://bunkermode.io"),
  openGraph: { type: "website", siteName: "Bunker", title: "Bunker — Built for what’s next", description: "Independent hash-based authorization for Solana. Explore the implementation and its security boundaries.", images: [{ url: "/brand/bunker-x-banner-1500x500.png", width: 1500, height: 500 }] },
  twitter: { card: "summary_large_image", images: ["/brand/bunker-x-banner-1500x500.png"] },
  icons: {
    icon: [
      { url: "/brand/bunker-favicon-dark-32.png", sizes: "32x32", type: "image/png", media: "(prefers-color-scheme: light)" },
      { url: "/brand/bunker-favicon-light-32.png", sizes: "32x32", type: "image/png", media: "(prefers-color-scheme: dark)" },
    ], shortcut: "/favicon.ico",
  },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
