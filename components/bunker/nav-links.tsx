"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
export const NAV = [
  ["/demo", "Demo"],
  ["/check", "Check a wallet"],
  ["/docs", "How it works"],
  ["/security", "Security"],
  ["/bounty", "Bounty"],
] as const;
export function NavLinks({ extra = [] }: { extra?: [string, string][] }) {
  const path = usePathname();
  return (
    <>
      {[...NAV, ...extra].map(([href, label]) => (
        <Link
          key={href}
          href={href}
          aria-current={path === href ? "page" : undefined}
        >
          {label}
        </Link>
      ))}
    </>
  );
}
