"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Warm the config route + RSC payload while the user is on /playlists. */
export function PrefetchPlaylistsConfig() {
  const router = useRouter();

  useEffect(() => {
    router.prefetch("/playlists/config");
    // Warm cached stats while the user is still on the dashboard.
    void fetch("/api/playlists/config/stats", { credentials: "include" }).catch(() => undefined);
  }, [router]);

  return null;
}
