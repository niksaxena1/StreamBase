"use client";

import { useEffect, useState } from "react";

export function LogoMark({ size = 18 }: { size?: number }) {
  const [mounted, setMounted] = useState(false);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setMounted(true);
    
    // Check current theme
    const checkTheme = () => {
      if (typeof window === "undefined") return;
      const html = document.documentElement;
      const theme = html.dataset.theme || 
                    (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      setIsDark(theme === "dark");
    };

    checkTheme();

    // Listen for theme changes
    const observer = new MutationObserver(checkTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    // Also listen for system theme changes
    const mediaQuery = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (mediaQuery) {
      mediaQuery.addEventListener("change", checkTheme);
    }

    return () => {
      observer.disconnect();
      if (mediaQuery) {
        mediaQuery.removeEventListener("change", checkTheme);
      }
    };
  }, []);

  // Use light logo as default during SSR to avoid hydration mismatch
  const logoSrc = mounted && isDark ? "/logo-dark.png" : "/logo-light.png";

  // Use regular img tag for now to avoid Next.js Image optimization issues
  return (
    <img
      src={logoSrc}
      alt="SpotiBase"
      width={size}
      height={size}
      className="object-contain"
      style={{ display: "block" }}
      onError={(e) => {
        // Fallback if image fails to load
        console.error(`Failed to load logo: ${logoSrc}`);
        e.currentTarget.style.display = "none";
      }}
    />
  );
}
