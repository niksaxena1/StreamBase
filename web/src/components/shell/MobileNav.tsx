"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navItems } from "./SideRail";

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 block sb-glass border-t pb-safe sm:hidden" style={{ borderColor: "var(--sb-border)" }}>
      <div className="flex h-20 items-center justify-around px-2 pb-2">
        {navItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center justify-center gap-1.5 rounded-lg p-3 transition-colors min-w-[60px] ${
                active
                  ? "text-black dark:text-white"
                  : "text-black/60 dark:text-white/60 hover:bg-black/5 dark:hover:bg-white/5"
              }`}
            >
              <div>{item.icon(active)}</div>
              <span className="text-[11px] font-medium leading-tight">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
