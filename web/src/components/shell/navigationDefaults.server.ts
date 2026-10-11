import "server-only";
import { cachedQuery } from "@/lib/supabase/cache";
import { CACHE_TTL_1H } from "@/lib/constants";
import { cache } from "react";
import { getRequestAppContext } from "@/lib/requestAppContext.server";
import { ALL_COMPETITORS_KEY, resolveCompetitorLabelKey } from "@/lib/competitorContext";
import type { DatasetMode } from "@/lib/datasetMode";
import type { NavigationDefaults } from "./navigationDefaults";
import { logError } from "@/lib/logger";

export const getNavigationDefaults = cache(async (datasetMode: DatasetMode): Promise<NavigationDefaults> => {
  // Own catalog's default needs no additional database reads.
  if (datasetMode === "own") return { datasetMode };
  try {
    const { svc, user, isAdmin, settings } = await getRequestAppContext();
    if (!user || !isAdmin) return { datasetMode, playlistKeys: [] };
    const comp = svc.schema("competitor");
    const { data: labels, error: labelError } = await cachedQuery(async () => await comp.from("labels")
      .select("label_key,display_name").eq("is_active", true).order("display_name", { ascending: true }), "navigation-competitor-labels-v1", CACHE_TTL_1H);
    if (labelError) throw new Error(labelError.message);
    const competitorLabelKey = resolveCompetitorLabelKey(settings?.competitor_label_key, labels ?? []);
    const { data: playlists, error } = await cachedQuery(async () => {
      let query = comp.from("playlists").select("playlist_key")
        .eq("is_active", true)
        .order("display_order", { ascending: true, nullsFirst: false })
        .order("display_name", { ascending: true });
      if (competitorLabelKey !== ALL_COMPETITORS_KEY) query = query.eq("label_key", competitorLabelKey);
      return await query;
    }, `navigation-competitor-playlists-v1-${competitorLabelKey ?? "none"}`, CACHE_TTL_1H);
    if (error) throw new Error(error.message);
    return { datasetMode, competitorLabelKey, playlistKeys: (playlists ?? []).map((p) => p.playlist_key) };
  } catch (error) {
    // Keep navigation available; the bare page retains its normal fallback.
    logError("[Navigation] Failed to resolve competitor playlists", error);
    return { datasetMode, playlistKeys: [] };
  }
});
