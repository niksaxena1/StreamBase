"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { DatasetMode } from "@/lib/datasetMode";
import { lastCatalogTrackIsrcStorageKey, readDatasetSelectionStorage } from "@/lib/datasetSelectionStorage";

export function RememberTrackSelection(props: {
  datasetMode?: DatasetMode;
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

    const mode = props.datasetMode ?? "own";
    const rememberedIsrc = readDatasetSelectionStorage(
      lastCatalogTrackIsrcStorageKey(mode),
      "sb:last_catalog_track_isrc",
    );

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
