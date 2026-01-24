"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

const STORAGE_KEY = "sb-theme";

function readTheme(): Theme {
  if (typeof window === "undefined") return "light"; // SSR safe default
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
  return mq?.matches ? "dark" : "light";
}

function applyTheme(t: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = t;
  try {
    window.localStorage.setItem(STORAGE_KEY, t);
  } catch {
    // ignore
  }
}

export function ThemeToggle() {
  // Start with a safe default for SSR, then sync with actual theme after mount
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // After mount, read the actual theme and apply it
    const actualTheme = readTheme();
    setTheme(actualTheme);
    applyTheme(actualTheme);
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted) {
      applyTheme(theme);
    }
  }, [theme, mounted]);

  const isDark = theme === "dark";

  // During SSR and before mount, render a neutral placeholder to avoid hydration mismatch
  if (!mounted) {
    return (
      <button
        type="button"
        aria-label="Toggle light and dark theme"
        className="sb-ring inline-flex h-8 w-8 items-center justify-center rounded-full bg-transparent text-xs font-medium transition hover:bg-black/5 dark:hover:bg-white/10"
      >
        <span className="text-sm">☼</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        const next: Theme = isDark ? "light" : "dark";
        setTheme(next);
      }}
      aria-label="Toggle light and dark theme"
      className="sb-ring inline-flex h-8 w-8 items-center justify-center rounded-full bg-transparent text-xs font-medium transition hover:bg-black/5 dark:hover:bg-white/10"
    >
      <span className="text-sm">{isDark ? "☾" : "☼"}</span>
    </button>
  );
}

