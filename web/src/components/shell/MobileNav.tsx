"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { navItems } from "./SideRail";

// Haptic feedback utility (#4)
function triggerHaptic(style: "light" | "medium" = "light") {
  // Try Vibration API (Android, some browsers)
  if (typeof navigator !== "undefined" && navigator.vibrate) {
    navigator.vibrate(style === "light" ? 10 : 20);
  }
}

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
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  const scrollTimerRef = useRef<number | null>(null);
  const prevBadgeCount = useRef(healthBadgeCount);
  const [badgeAnimating, setBadgeAnimating] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  // Detect keyboard open via viewport height change (#10)
  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;

    const viewport = window.visualViewport;
    const initialHeight = viewport.height;

    function onResize() {
      // If viewport shrinks significantly, keyboard is likely open
      const heightDiff = initialHeight - viewport.height;
      setIsKeyboardOpen(heightDiff > 150);
    }

    viewport.addEventListener("resize", onResize);
    return () => viewport.removeEventListener("resize", onResize);
  }, []);

  // Scroll detection
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

  // Badge count change animation (#8)
  useEffect(() => {
    if (healthBadgeCount !== prevBadgeCount.current && healthBadgeCount > 0) {
      setBadgeAnimating(true);
      const timer = setTimeout(() => setBadgeAnimating(false), 300);
      prevBadgeCount.current = healthBadgeCount;
      return () => clearTimeout(timer);
    }
    prevBadgeCount.current = healthBadgeCount;
  }, [healthBadgeCount]);

  const handleNavClick = useCallback(() => {
    triggerHaptic("light");
  }, []);

  return (
    <nav
      ref={navRef}
      className={[
        "sb-mobile-nav sb-glass-nav sm:hidden",
        hasScrolled ? "sb-glass-nav--scrolled" : "",
        isScrolling ? "sb-glass-nav--scrolling" : "",
        isKeyboardOpen ? "sb-glass-nav--keyboard" : "",
      ].join(" ")}
    >
      <div className="flex h-[72px] items-center justify-around px-1">
        {navItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const isHealth = item.href === "/health";
          const showBadge = isHealth && healthBadgeCount > 0;
          
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={handleNavClick}
              className={[
                // #3: Larger touch targets - flex-1 for equal distribution, min 48px height
                "relative flex flex-1 flex-col items-center justify-center gap-1 rounded-xl py-2 transition-all duration-150",
                "min-h-[48px] max-w-[80px]",
                // #2: Refined active state - no background fill, use indicator instead
                active
                  ? "text-[var(--sb-text)]"
                  : "text-[var(--sb-muted)] hover:text-[var(--sb-text)]",
              ].join(" ")}
            >
              {/* Icon container with slightly larger icons */}
              <div className="relative flex items-center justify-center">
                <div className={[
                  "transition-transform duration-150",
                  active ? "scale-110" : "scale-100",
                ].join(" ")}>
                  {item.icon(active)}
                </div>
                
                {/* #8: Health badge with animation */}
                {showBadge && (
                  <span
                    className={[
                      "absolute -right-2.5 -top-1.5 z-10 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none",
                      healthHasCritical
                        ? "bg-red-500 text-white"
                        : "bg-orange-500 text-white",
                      // Animation on count change
                      badgeAnimating ? "animate-badge-pop" : "",
                    ].join(" ")}
                    style={{
                      boxShadow: "0 2px 8px rgba(0, 0, 0, 0.3)",
                    }}
                    title={`${healthBadgeCount} warning${healthBadgeCount !== 1 ? "s" : ""}${healthHasCritical ? " (critical)" : ""}`}
                  >
                    {healthBadgeCount > 99 ? "99+" : healthBadgeCount}
                  </span>
                )}
              </div>
              
              {/* Label */}
              <span className={[
                "text-[10px] font-medium leading-tight transition-all duration-150",
                active ? "font-semibold" : "",
              ].join(" ")}>
                {item.label}
              </span>
              
              {/* #2: Active indicator pill below label */}
              <div
                className={[
                  "absolute bottom-1 h-1 rounded-full bg-[var(--sb-accent)] transition-all duration-200",
                  active ? "w-5 opacity-100" : "w-0 opacity-0",
                ].join(" ")}
                style={{
                  boxShadow: active ? "0 0 8px var(--sb-accent)" : "none",
                }}
              />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
