"use client";

import { useEffect } from "react";
import { catalogDefaultsHref } from "./catalogDefaults";

/** Next's native-history integration updates search params without an RSC refetch. */
export function useSyncCatalogSelection(artistId: string, isrc: string | null) {
  useEffect(() => {
    const href = catalogDefaultsHref(window.location.href, artistId, isrc);
    if (href) window.history.replaceState(null, "", href);
  }, [artistId, isrc]);
}
