import { CACHE_TTL_1H } from "@/lib/constants";
import { cachedQuery } from "@/lib/supabase/cache";

import { fetchDisplayedWarnings, fetchMissingCatalogTracks, type WarningAuditView } from "./fetchWarningDetails";
import type { DisplayedWarning, MissingCatalogTrack, PlaylistMeta } from "./types";

export async function cachedDisplayedWarnings(
  runDate: string,
  playlistMeta: Record<string, PlaylistMeta>,
  page = 1,
  view: WarningAuditView = "active",
) {
  return cachedQuery(
    async () => {
      const result = await fetchDisplayedWarnings(runDate, playlistMeta, page, undefined, view);
      return { data: result, error: null };
    },
    `health-warnings-${runDate}-${view}-${page}`,
    CACHE_TTL_1H,
  );
}

export async function cachedMissingCatalogTracks(runDate: string) {
  return cachedQuery(
    async () => {
      const rows = await fetchMissingCatalogTracks(runDate);
      return { data: rows, error: null };
    },
    `health-missing-catalog-${runDate}`,
    CACHE_TTL_1H,
  );
}

export type { DisplayedWarning, MissingCatalogTrack };
