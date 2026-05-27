import { isAllCompetitorsKey, resolveCompetitorLabelKey } from "@/lib/competitorContext";
import { normalizeDatasetMode, type DatasetMode } from "@/lib/datasetMode";
import type { SupabaseClient } from "@supabase/supabase-js";

export type AdminDatasetContext = {
  datasetMode: DatasetMode;
  competitorLabelKey: string | null;
};

/** Admin API routes: resolve the active catalog universe for the signed-in user. */
export async function getAdminUserDatasetContext(
  svc: SupabaseClient,
  userId: string,
): Promise<AdminDatasetContext> {
  const { data: settings } = await svc
    .from("user_settings")
    .select("dataset_mode,competitor_label_key")
    .eq("user_id", userId)
    .maybeSingle();

  const datasetMode = normalizeDatasetMode(settings?.dataset_mode);
  let competitorLabelKey =
    typeof settings?.competitor_label_key === "string" && settings.competitor_label_key.trim()
      ? settings.competitor_label_key.trim()
      : null;

  if (datasetMode === "competitor" && !competitorLabelKey) {
    const { data: labels } = await svc
      .schema("competitor")
      .from("labels")
      .select("label_key,display_name")
      .eq("is_active", true)
      .order("display_name", { ascending: true });
    competitorLabelKey = resolveCompetitorLabelKey(
      null,
      (labels ?? []) as Array<{ label_key: string; display_name: string }>,
    );
  }

  return { datasetMode, competitorLabelKey };
}

export function competitorPlaylistKeysForLabel(
  playlists: Array<{ playlist_key: string; label_key: string }>,
  competitorLabelKey: string | null,
): Set<string> {
  if (!competitorLabelKey || isAllCompetitorsKey(competitorLabelKey)) {
    return new Set(playlists.map((p) => p.playlist_key));
  }
  return new Set(
    playlists.filter((p) => p.label_key === competitorLabelKey).map((p) => p.playlist_key),
  );
}
