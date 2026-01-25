"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navItems } from "./SideRail";

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 block border-t border-black/5 bg-white/80 backdrop-blur-lg dark:border-white/10 dark:bg-black/80 pb-safe sm:hidden">
      <div className="flex h-16 items-center justify-around px-2 pb-2">
        {navItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center justify-center gap-1 rounded-lg p-2 transition-colors ${
                active
                  ? "text-black dark:text-white"
                  : "text-neutral-500 hover:bg-black/5 dark:hover:bg-white/5"
              }`}
            >
              <div className="scale-90">{item.icon(active)}</div>
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
