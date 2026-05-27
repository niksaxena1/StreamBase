import { isAllCompetitorsKey, resolveCompetitorLabelKey } from "@/lib/competitorContext";
import { normalizeDatasetMode, type DatasetMode } from "@/lib/datasetMode";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export type CompetitorLabelWithImage = {
  label_key: string;
  display_name: string;
  image_url: string | null;
  accent_hex: string | null;
};

export type CompetitorShellContext = {
  datasetMode: DatasetMode;
  competitorLabels: CompetitorLabelWithImage[];
  competitorLabelKey: string | null;
  competitorAccentHex: string | null;
  competitorDisplayName: string | null;
  titleTemplate: string;
};

async function loadCompetitorLabelsWithImages(): Promise<CompetitorLabelWithImage[]> {
  const svc = supabaseService();
  const { data: labels } = await svc
    .schema("competitor")
    .from("labels")
    .select("label_key,display_name,accent_hex")
    .eq("is_active", true)
    .order("display_name", { ascending: true });

  const { data: playlists } = await svc
    .schema("competitor")
    .from("playlists")
    .select("label_key,spotify_playlist_image_url,display_order")
    .eq("is_active", true)
    .order("display_order", { ascending: true, nullsFirst: false });

  const imageByLabel = new Map<string, string | null>();
  for (const playlist of playlists ?? []) {
    const lk = String(playlist.label_key ?? "");
    if (!lk || imageByLabel.has(lk)) continue;
    imageByLabel.set(lk, playlist.spotify_playlist_image_url ?? null);
  }

  return (labels ?? []).map((label) => ({
    label_key: String(label.label_key),
    display_name: String(label.display_name),
    accent_hex: label.accent_hex ? String(label.accent_hex).replace(/^#/, "").toLowerCase() : null,
    image_url: imageByLabel.get(String(label.label_key)) ?? null,
  }));
}

function buildTitleTemplate(datasetMode: DatasetMode, displayName: string | null): string {
  if (datasetMode !== "competitor") return "%s";
  if (displayName) return `%s · ${displayName}`;
  return "%s · Competitors";
}

export async function getCompetitorShellContext(): Promise<CompetitorShellContext> {
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) {
    return {
      datasetMode: "own",
      competitorLabels: [],
      competitorLabelKey: null,
      competitorAccentHex: null,
      competitorDisplayName: null,
      titleTemplate: "%s",
    };
  }

  const svc = supabaseService();
  const { data: settings } = await svc
    .from("user_settings")
    .select("dataset_mode,competitor_label_key")
    .eq("user_id", user.id)
    .maybeSingle();

  const datasetMode = normalizeDatasetMode(settings?.dataset_mode);
  const competitorLabels = await loadCompetitorLabelsWithImages();
  const competitorLabelKey = resolveCompetitorLabelKey(settings?.competitor_label_key, competitorLabels);

  let competitorAccentHex: string | null = null;
  let competitorDisplayName: string | null = null;

  if (datasetMode === "competitor" && competitorLabelKey && !isAllCompetitorsKey(competitorLabelKey)) {
    const active = competitorLabels.find((l) => l.label_key === competitorLabelKey);
    if (active) {
      competitorDisplayName = active.display_name;
      competitorAccentHex = active.accent_hex;
    }
  }

  return {
    datasetMode,
    competitorLabels,
    competitorLabelKey,
    competitorAccentHex,
    competitorDisplayName,
    titleTemplate: buildTitleTemplate(datasetMode, competitorDisplayName),
  };
}
