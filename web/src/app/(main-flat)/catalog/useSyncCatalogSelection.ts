"use client";

import { useEffect } from "react";
import { catalogDefaultsHref } from "./catalogDefaults";
import { useNavigationRouter } from "@/components/shell/useNavigationRouter";
import { lastArtistIdStorageKey, readDatasetSelectionStorage, writeDatasetSelectionStorage } from "@/lib/datasetSelectionStorage";
import type { DatasetMode } from "@/lib/datasetMode";
import { rememberedCatalogArtist, rememberedArtistHref } from "./rememberedArtist";
import { isRememberedOwnArtistValid } from "./rememberedArtist.actions";

/** Next's native-history integration updates search params without an RSC refetch. */
export function useSyncCatalogSelection(artistId: string, isrc: string | null, mode: DatasetMode, labelKey: string | null | undefined, artists: Array<{ id: string }>) {
  const router = useNavigationRouter();
  useEffect(() => {
    let canceled = false;
    const entry = window.location.href;
    const key = lastArtistIdStorageKey(mode, labelKey);
    let memory: string | null = null;
    try {
      memory = mode === "own" ? readDatasetSelectionStorage(key, "sb:last_artist_id") : localStorage.getItem(key);
    } catch { /* Storage is optional. */ }
    const candidate = rememberedCatalogArtist(entry, memory, artistId);
    const restore = async () => {
      // Competitor options contain the complete active label context. Own options are capped.
      const valid = candidate && (artists.some((artist) => artist.id === candidate) ||
        (mode === "own" && await isRememberedOwnArtistValid(candidate)));
      if (canceled || window.location.href !== entry) return;
      if (candidate && valid) {
        router.replace(rememberedArtistHref(entry, candidate));
        return;
      }
      if (artistId) writeDatasetSelectionStorage(key, artistId);
      const href = catalogDefaultsHref(entry, artistId, isrc);
      if (href) window.history.replaceState(null, "", href);
    };
    void restore();
    return () => { canceled = true; };
  }, [artistId, isrc, mode, labelKey, artists, router]);
}
