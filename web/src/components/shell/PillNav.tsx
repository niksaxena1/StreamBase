"use client";

import { NavigationLink as Link } from "./NavigationLink";
import { useNavigationEntries } from "./useNavigationEntries";
import type { NavigationDefaults } from "./navigationDefaults";
import { usePathname } from "next/navigation";

const items = [
  { href: "/playlists", label: "Playlist Dash" },
  { href: "/collectors", label: "Collectors" },
  { href: "/catalog", label: "Catalog" },
  { href: "/playlists", label: "Playlists" },
  { href: "/health", label: "System Health" },
];

export function PillNav({ navigationDefaults = { datasetMode: "own" } }: { navigationDefaults?: NavigationDefaults }) {
  const pathname = usePathname();
  const entryHref = useNavigationEntries(navigationDefaults);

  return (
    <nav className="sb-ring hidden items-center gap-0.5 rounded-full bg-white/70 p-0.5 text-xs sm:flex">
      {items.map((it) => {
        const active = pathname === it.href || pathname.startsWith(`${it.href}/`);
        return (
          <Link
            key={`${it.href}-${it.label}`}
            href={entryHref(it.href)}
            className={[
              "rounded-full px-2.5 py-1.5 transition",
              active
                ? "bg-black text-white shadow-sm dark:bg-white dark:text-black"
                : "text-black/70 hover:bg-white/70 dark:text-white/70 dark:hover:bg-white/20",
            ].join(" ")}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}

