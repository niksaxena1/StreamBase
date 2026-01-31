"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { navItems } from "./SideRail";

export function MobileNav({
  healthBadgeCount = 0,
  healthHasCritical = false,
}: {
  healthBadgeCount?: number;
  healthHasCritical?: boolean;
}) {
  const pathname = usePathname();
  const [hasScrolled, setHasScrolled] = useState(false);
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTimerRef = useRef<number | null>(null);

  useEffect(() => {
    function onScroll() {
      const y = window.scrollY || 0;
      setHasScrolled(y > 4);

      setIsScrolling(true);
      if (scrollTimerRef.current) window.clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = window.setTimeout(() => {
        setIsScrolling(false);
      }, 160);
    }

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (scrollTimerRef.current) window.clearTimeout(scrollTimerRef.current);
    };
  }, []);

  return (
    <nav
      className={[
        "fixed bottom-0 left-0 right-0 z-50 block sb-glass sb-glass-nav pb-safe sm:hidden",
        hasScrolled ? "sb-glass-nav--scrolled" : "",
        isScrolling ? "sb-glass-nav--scrolling" : "",
      ].join(" ")}
      style={{ borderColor: "var(--sb-border)" }}
    >
      <div className="flex h-20 items-center justify-around px-2 pb-2">
        {navItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const isHealth = item.href === "/health";
          const showBadge = isHealth && healthBadgeCount > 0;
          
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`relative flex flex-col items-center justify-center gap-1.5 rounded-lg p-3 transition-colors min-w-[60px] ${
                active
                  ? "bg-[var(--sb-accent)] text-black"
                  : "text-black/70 dark:text-white/70 hover:bg-black/5 dark:hover:bg-white/5"
              }`}
            >
              <div className="relative">
                {item.icon(active)}
                {showBadge && (
                  <span
                    className={[
                      "absolute -right-1 -top-1 z-10 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[9px] font-semibold leading-none",
                      healthHasCritical
                        ? "bg-red-500 text-white"
                        : "bg-orange-500 text-white",
                    ].join(" ")}
                    style={{
                      boxShadow: "0 2px 6px rgba(0, 0, 0, 0.25)",
                    }}
                    title={`${healthBadgeCount} warning${healthBadgeCount !== 1 ? "s" : ""}${healthHasCritical ? " (critical)" : ""}`}
                  >
                    {healthBadgeCount > 99 ? "99+" : healthBadgeCount}
                  </span>
                )}
              </div>
              <span className="text-[11px] font-medium leading-tight">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
