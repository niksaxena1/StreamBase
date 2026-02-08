"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function RememberTrackSelection(props: {
  artistId: string;
  hasTrack: boolean;
}) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const router = useRouter();

  // If no track is selected, try to restore from localStorage
  useEffect(() => {
    if (props.hasTrack) return; // Already have a track selected
    if (!props.artistId) return; // No artist to select track for

    let rememberedIsrc: string | null = null;
    try {
      rememberedIsrc = localStorage.getItem("sb:last_catalog_track_isrc");
    } catch {
      // ignore
    }

    if (!rememberedIsrc) return;

    // Restore the remembered track
    const next = new URLSearchParams(sp.toString());
    next.set("isrc", rememberedIsrc);
    const href = `${pathname}?${next.toString()}`;
    try {
      window.location.replace(href);
    } catch {
      // ignore
    }
  }, [props.hasTrack, props.artistId, pathname, sp]);

  return null;
}
