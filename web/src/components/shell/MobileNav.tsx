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
  healthInfoOnly = false,
}: {
  healthBadgeCount?: number;
  healthHasCritical?: boolean;
  healthInfoOnly?: boolean;
}) {
  const pathname = usePathname();
  const [hasScrolled, setHasScrolled] = useState(false);
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  const scrollTimerRef = useRef<number | null>(null);
  const prevBadgeCount = useRef(healthBadgeCount);
  const [badgeAnimating, setBadgeAnimating] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const rafRef = useRef<number | null>(null);

  // ============================================================================
  // BULLETPROOF VISUAL VIEWPORT POSITIONING
  // ============================================================================
  // On mobile browsers, `position: fixed` is relative to the "layout viewport",
  // but the user sees the "visual viewport" which moves during:
  // - Pinch zoom
  // - Address bar show/hide
  // - Keyboard open/close
  // - Momentum scrolling overshoot
  // - Page transitions
  //
  // This effect directly positions the nav at the bottom of the visual viewport
  // using the VisualViewport API, updated on every relevant event via rAF.
  // ============================================================================
  useEffect(() => {
    if (typeof window === "undefined") return;
    
    const nav = navRef.current;
    if (!nav) return;

    const vv = window.visualViewport;
    
    // Fallback for browsers without VisualViewport API
    if (!vv) {
      nav.style.position = "fixed";
      nav.style.bottom = "0";
      nav.style.left = "0";
      nav.style.right = "0";
      return;
    }

    let ticking = false;

    const updatePosition = () => {
      // Calculate where the bottom of the visual viewport is relative to the layout viewport
      // vv.offsetTop = distance from layout viewport top to visual viewport top
      // vv.height = height of visual viewport
      // So the visual viewport bottom is at: vv.offsetTop + vv.height
      // We want the nav's bottom to be at that position
      
      const visualBottom = vv.offsetTop + vv.height;
      const layoutHeight = window.innerHeight;
      
      // How far from the layout viewport bottom is the visual viewport bottom?
      // If positive, visual viewport bottom is above layout viewport bottom (e.g., zoomed in)
      // If negative, visual viewport bottom is below (shouldn't happen normally)
      const bottomOffset = layoutHeight - visualBottom;
      
      // Position the nav so its bottom aligns with visual viewport bottom
      // We use `top` instead of `bottom` for more predictable behavior
      const navHeight = nav.offsetHeight || 72;
      const topPosition = visualBottom - navHeight;
      
      // Use transform for smooth GPU-accelerated positioning
      nav.style.position = "fixed";
      nav.style.top = "0";
      nav.style.bottom = "auto";
      nav.style.left = `${vv.offsetLeft}px`;
      nav.style.width = `${vv.width}px`;
      nav.style.transform = `translateY(${topPosition}px)`;
      
      // Detect keyboard (significant height reduction)
      const heightRatio = vv.height / layoutHeight;
      setIsKeyboardOpen(heightRatio < 0.7);
      
      ticking = false;
    };

    const requestUpdate = () => {
      if (!ticking) {
        ticking = true;
        rafRef.current = requestAnimationFrame(updatePosition);
      }
    };

    // Initial position
    updatePosition();

    // Listen to all events that can change the visual viewport
    vv.addEventListener("resize", requestUpdate);
    vv.addEventListener("scroll", requestUpdate);
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);
    window.addEventListener("orientationchange", requestUpdate);
    
    // Also update on touch events for immediate response during gestures
    document.addEventListener("touchmove", requestUpdate, { passive: true });
    document.addEventListener("touchend", requestUpdate, { passive: true });

    return () => {
      vv.removeEventListener("resize", requestUpdate);
      vv.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
      window.removeEventListener("orientationchange", requestUpdate);
      document.removeEventListener("touchmove", requestUpdate);
      document.removeEventListener("touchend", requestUpdate);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Scroll detection for glass effects
  useEffect(() => {
    function onScroll() {
      const y = window.scrollY || 0;
      setHasScrolled(y > 4);
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
        isKeyboardOpen ? "sb-mobile-nav--keyboard" : "",
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
                        : healthInfoOnly
                          ? "bg-blue-500 text-white"
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
