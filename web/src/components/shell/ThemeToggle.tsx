"use client";

import { useEffect, useState } from "react";
import { IconButton } from "@/components/ui/Button";

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
  const [theme, setTheme] = useState<Theme>(() => readTheme());
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const isDark = theme === "dark";

  return (
    <IconButton
      type="button"
      onClick={() => {
        const next: Theme = isDark ? "light" : "dark";
        setTheme(next);
      }}
      aria-label="Toggle light and dark theme"
    >
      <span className="text-xs leading-none" suppressHydrationWarning>
        {isDark ? "☾" : "☼"}
      </span>
    </IconButton>
  );
}

