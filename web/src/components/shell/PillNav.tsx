"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Dashboard" },
  { href: "/playlists", label: "Playlists" },
  { href: "/health", label: "System Health" },
];

export function PillNav() {
  const pathname = usePathname();

  return (
    <nav className="sb-ring hidden items-center gap-1 rounded-full bg-white/70 p-1 text-sm sm:flex">
      {items.map((it) => {
        const active =
          it.href === "/"
            ? pathname === "/"
            : pathname.startsWith(it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            className={[
              "rounded-full px-4 py-2 transition",
              active
                ? "bg-black text-white shadow-sm"
                : "text-black/70 hover:bg-white/70",
            ].join(" ")}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}

