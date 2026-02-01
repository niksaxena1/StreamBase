"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { LogOut, Settings, User } from "lucide-react";

import { IconButton } from "@/components/ui/Button";
import { supabaseBrowser } from "@/lib/supabase/client";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function UserMenu() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    function onDocPointerDown(e: MouseEvent | TouchEvent) {
      const el = wrapRef.current;
      if (!el) return;
      const target = e.target as Node | null;
      if (target && el.contains(target)) return;
      setOpen(false);
    }

    document.addEventListener("mousedown", onDocPointerDown, true);
    document.addEventListener("touchstart", onDocPointerDown, true);
    return () => {
      document.removeEventListener("mousedown", onDocPointerDown, true);
      document.removeEventListener("touchstart", onDocPointerDown, true);
    };
  }, [open]);

  async function logout() {
    try {
      const sb = supabaseBrowser();
      await sb.auth.signOut();
    } finally {
      window.location.href = "/login";
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <IconButton
        aria-label="User menu"
        title="User menu"
        variant="ghost"
        onClick={() => setOpen((v) => !v)}
      >
        <User className="h-4 w-4" />
      </IconButton>

      {open ? (
        <div
          className="absolute right-0 top-full z-50 mt-2 w-44 sb-card p-1"
          onMouseDown={(e) => e.stopPropagation()}
        >
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
      ) : null}
    </div>
  );
}

