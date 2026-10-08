// Bunker icon set (brand kit v3): 24px grid, 2px stroke, square caps, drawn from
// the mark's geometry. Path data is copied from the kit's SVG files.
const PATHS = {
  "vault": "M4 21V8L12 3l8 5v13M8 21v-9l4-3 4 3v9M11 17h2",
  "everyday-wallet": "M3 6h16v14H3V6Zm0 0 12-3v3M19 11h2v5h-7v-5h5M17 13.5h.01",
  "bunker-key": "M3 10V5l4-3 4 3v5l-4 3-4-3Zm4 3v9m0-4h4m-4 3h3",
  "recovery-kit": "M4 21V4h11l5 5v12H4Zm11-17v5h5M8 18v-5l4-3 4 3v5M11 16h2",
  "deposit": "M4 21v-8l8-5 8 5v8M8 21v-6l4-3 4 3v6M12 2v7m-3-3 3 3 3-3",
  "withdraw": "M4 21v-8l8-5 8 5v8M8 21v-6l4-3 4 3v6M12 9V2m-3 3 3-3 3 3",
  "lock-changed": "M7 19v-8l5-3 5 3v8H7Zm-4-5V7l5-4m-5 4V3m0 4h4m14 3v7l-5 4m5-4v4m0-4h-4",
  "waiting-period": "M4 21V8l8-5 8 5v13H4Zm8-12v5l3 2",
  "alert": "M4 18V9l8-6 8 6v9H4Zm6 3h4m-2-13v5m0 2v.01",
  "approved-address": "M3 15V7l7-4 7 4v7M7 15V9l3-2 3 2v6m-9 6h7m3-3 3 3 5-6",
  "backup-verified": "M3 20V3h10l5 5v4M13 3v5h5M7 13v-3l3-2 3 2v3m0 6 3 3 6-7",
  "backup-missing": "M3 20V3h10l5 5v4M13 3v5h5M7 13v-3l3-2 3 2v3m1 3 7 7m0-7-7 7",
  "review-pending": "M4 21V8l8-5 8 5v16H4Zm4-9h8m-8 4h4m4 0v.01",
  "simulation": "M3 21V8l9-5 9 5v13H3Zm7-10 6 4-6 4v-8Z",
  "emergency": "M4 21V8l8-5 8 5v13H4Zm8-12v6m0 3v.01",
  "external-link": "M10 4H4v16h16v-6M13 3h8v8M10 14 21 3",
} as const;
export type BunkerIconName = keyof typeof PATHS;
export function BIcon({
  name,
  size = 24,
  className,
}: {
  name: BunkerIconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      className={className}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
