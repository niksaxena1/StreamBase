"use client";

import { supabaseBrowser } from "@/lib/supabase/client";

export function LogoutButton() {
  async function onClick() {
    const sb = supabaseBrowser();
    await sb.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="sb-ring inline-flex h-8 items-center justify-center gap-2 rounded-full bg-white/70 px-3 text-xs text-black/70 transition hover:bg-white"
      title="Log out"
    >
      <span className="text-xs font-medium">Logout</span>
    </button>
  );
}

