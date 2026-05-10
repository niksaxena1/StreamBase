"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

export function LogoMark({ size = 18 }: { size?: number }) {
  const [isDark, setIsDark] = useState(false);
  const [mounted, setMounted] = useState(false);

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

  // Always use light logo during SSR and initial render to prevent hydration mismatch
  // Only switch to dark after client mount
  const logoSrc = mounted && isDark ? "/logo-dark.png" : "/logo-light.png";

  return (
    <Image
      src={logoSrc}
      alt="SBase"
      width={size}
      height={size}
      className="object-contain"
      style={{ 
        display: "block",
        filter: "none",
        imageRendering: "auto",
        minWidth: size,
        minHeight: size,
      }}
      priority
      unoptimized
      suppressHydrationWarning
    />
  );
}
