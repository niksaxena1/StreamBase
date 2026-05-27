"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home } from "lucide-react";

export function BrandLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const isHome = pathname === "/" || pathname === href;

  if (isHome) {
    return (
      <Link
        href={href}
        className="font-display text-sm font-semibold tracking-tight transition-opacity hover:opacity-80"
        suppressHydrationWarning
      >
        {label}
      </Link>
    );
  }

  return (
    <>
      <Link
        href={href}
        className="hidden font-display text-sm font-semibold tracking-tight transition-opacity hover:opacity-80 sm:inline"
        suppressHydrationWarning
      >
        {label}
      </Link>
      <Link
        href={href}
        aria-label={label}
        className="flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-black/5 dark:hover:bg-white/5 sm:hidden"
        style={{ color: "var(--sb-muted)" }}
        suppressHydrationWarning
      >
        <Home className="h-3 w-3" aria-hidden="true" />
      </Link>
    </>
  );
}
