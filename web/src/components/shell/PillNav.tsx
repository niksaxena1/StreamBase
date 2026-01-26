"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/playlists", label: "Playlist Dash" },
  { href: "/collectors", label: "Collectors" },
  { href: "/catalog", label: "Catalog" },
  { href: "/tracks", label: "Tracks" },
  { href: "/playlists", label: "Playlists" },
  { href: "/health", label: "System Health" },
];

export function PillNav() {
  const pathname = usePathname();

  return (
    <nav className="sb-ring hidden items-center gap-0.5 rounded-full bg-white/70 p-0.5 text-xs sm:flex">
      {items.map((it) => {
        const active = pathname === it.href || pathname.startsWith(`${it.href}/`);
        return (
          <Link
            key={it.href}
            href={it.href}
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

