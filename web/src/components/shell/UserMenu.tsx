"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookOpen, LogOut, Settings, User, Moon, Sun } from "lucide-react";

import { IconButton } from "@/components/ui/Button";
import { supabaseBrowser } from "@/lib/supabase/client";

type Theme = "light" | "dark";

const STORAGE_KEY = "sb-theme";

function readTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return "dark";
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

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function UserMenu() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => readTheme());
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // On /catalog + /playlists, some page content uses sticky/high z-index layers.
  // The header itself is a stacking context, so we render the dropdown in a portal there
  // to guarantee it sits above charts/tables/filters.
  const useHighZPortal = useMemo(() => {
    const p = (pathname ?? "").toLowerCase();
    return p === "/catalog" || p.startsWith("/catalog/") || p === "/playlists" || p.startsWith("/playlists/");
  }, [pathname]);

  const [portalPos, setPortalPos] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (!open) return;

    function onDocPointerDown(e: MouseEvent | TouchEvent) {
      const el = wrapRef.current;
      if (!el) return;
      const target = e.target as Node | null;
      if (target && el.contains(target)) return;
      if (useHighZPortal && target && menuRef.current?.contains(target)) return;
      setOpen(false);
    }

    document.addEventListener("mousedown", onDocPointerDown, true);
    document.addEventListener("touchstart", onDocPointerDown, true);
    return () => {
      document.removeEventListener("mousedown", onDocPointerDown, true);
      document.removeEventListener("touchstart", onDocPointerDown, true);
    };
  }, [open, useHighZPortal]);

  useEffect(() => {
    if (!open || !useHighZPortal) return;

    const updatePos = () => {
      const btn = buttonRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const top = Math.round(r.bottom + 8);
      const right = Math.round(window.innerWidth - r.right);
      setPortalPos({ top, right });
    };

    updatePos();

    window.addEventListener("resize", updatePos);
    // Keep aligned if layout shifts while open.
    window.addEventListener("scroll", updatePos, true);
    return () => {
      window.removeEventListener("resize", updatePos);
      window.removeEventListener("scroll", updatePos, true);
    };
  }, [open, useHighZPortal]);

  async function logout() {
    try {
      const sb = supabaseBrowser();
      await sb.auth.signOut();
    } finally {
      window.location.href = "/login";
    }
  }

  const isDark = theme === "dark";
  const nextTheme: Theme = isDark ? "light" : "dark";

  const menuContent = (
    <div
      ref={menuRef}
      className={cx(
        "sb-card p-1",
        useHighZPortal ? "fixed z-[120] w-44" : "absolute right-0 top-full z-50 mt-2 w-44",
      )}
      style={useHighZPortal ? { top: portalPos?.top ?? 0, right: portalPos?.right ?? 0 } : undefined}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => {
          setTheme(nextTheme);
        }}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition hover:bg-black/5 dark:hover:bg-white/10"
        title={isDark ? "Switch to light theme" : "Switch to dark theme"}
      >
        <span className="inline-flex" suppressHydrationWarning>
          {isDark ? <Sun className="h-4 w-4 opacity-70" /> : <Moon className="h-4 w-4 opacity-70" />}
        </span>
        <span>{isDark ? "Light Mode" : "Dark Mode"}</span>
      </button>

      {/* Mobile-only: settings is otherwise available in the desktop side rail */}
      <Link
        href="/settings"
        className={cx(
          "sm:hidden",
          "flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs transition hover:bg-black/5 dark:hover:bg-white/10",
        )}
        onClick={() => setOpen(false)}
      >
        <Settings className="h-4 w-4 opacity-70" />
        <span>Settings</span>
      </Link>

      <Link
        href="/docs"
        className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs transition hover:bg-black/5 dark:hover:bg-white/10"
        onClick={() => setOpen(false)}
        title="Docs"
      >
        <BookOpen className="h-4 w-4 opacity-70" />
        <span>Docs</span>
      </Link>

      <button
        type="button"
        onClick={logout}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition hover:bg-black/5 dark:hover:bg-white/10"
        title="Log out"
      >
        <LogOut className="h-4 w-4 opacity-70" />
        <span>Logout</span>
      </button>
    </div>
  );

  return (
    <div ref={wrapRef} className="relative">
      <IconButton
        ref={buttonRef}
        aria-label="User menu"
        title="User menu"
        variant="ghost"
        onClick={() => setOpen((v) => !v)}
      >
        <User className="h-4 w-4" />
      </IconButton>

      {open
        ? useHighZPortal && typeof document !== "undefined"
          ? createPortal(menuContent, document.body)
          : menuContent
        : null}
    </div>
  );
}

