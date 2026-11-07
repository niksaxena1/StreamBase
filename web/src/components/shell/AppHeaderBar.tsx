"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Glass } from "glisse";

/** Pages with their own sticky filter bar: the app header scrolls away there so that bar can stick to the top. */
const SCROLLING_HEADER_PREFIXES = ["/playlists", "/catalog"];

export function headerScrollsAway(pathname: string | null): boolean {
  if (!pathname) return false;
  return SCROLLING_HEADER_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function AppHeaderBar({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const position = headerScrollsAway(pathname) ? "relative z-20" : "sticky top-3 z-30";
  return (
    <Glass role="banner" className={`sb-app-header sb-glass-toolbar ${position} px-2 py-1.5`}>
      {children}
    </Glass>
  );
}
