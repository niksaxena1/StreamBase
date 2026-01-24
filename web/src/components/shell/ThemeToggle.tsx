"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

const STORAGE_KEY = "sb-theme";

function readTheme(): Theme {
  const stored =
    typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
  if (stored === "light" || stored === "dark") return stored;

  const mq =
    typeof window !== "undefined"
      ? window.matchMedia?.("(prefers-color-scheme: dark)")
      : null;
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
  const [theme, setTheme] = useState<Theme>(() => readTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const isDark = theme === "dark";

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

