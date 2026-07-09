import { isAllCompetitorsKey, resolveCompetitorLabelKey } from "@/lib/competitorContext";
import { applyResolvedLabelAccents } from "@/lib/competitorLabelAccents";
import { CACHE_TTL_1H } from "@/lib/constants";
import { normalizeDatasetMode, type DatasetMode } from "@/lib/datasetMode";
import { cachedQuery } from "@/lib/supabase/cache";
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

type CompetitorLabelRow = {
  label_key: string;
  display_name: string;
  accent_hex: string | null;
};

type CompetitorPlaylistImageRow = {
  label_key: string;
  spotify_playlist_image_url: string | null;
  display_order: number | null;
};

type CompetitorShellRows = {
  labels: CompetitorLabelRow[];
  playlists: CompetitorPlaylistImageRow[];
};

export async function loadCompetitorLabelsWithImages(): Promise<CompetitorLabelWithImage[]> {
  const svc = supabaseService();
  const { data: rows } = await cachedQuery<CompetitorShellRows>(
    async () => {
      const comp = svc.schema("competitor");
      const [labelsResult, playlistsResult] = await Promise.all([
        comp
          .from("labels")
          .select("label_key,display_name,accent_hex")
          .eq("is_active", true)
          .order("display_name", { ascending: true }),
        comp
          .from("playlists")
          .select("label_key,spotify_playlist_image_url,display_order")
          .eq("is_active", true)
          .order("display_order", { ascending: true, nullsFirst: false }),
      ]);

      const error = labelsResult.error ?? playlistsResult.error;
      if (error) return { data: null, error };

      return {
        data: {
          labels: (labelsResult.data ?? []) as CompetitorLabelRow[],
          playlists: (playlistsResult.data ?? []) as CompetitorPlaylistImageRow[],
        },
        error: null,
      };
    },
    "competitor-shell-labels-v2",
    CACHE_TTL_1H,
  );

  const imageByLabel = new Map<string, string | null>();
  for (const playlist of rows?.playlists ?? []) {
    const lk = String(playlist.label_key ?? "");
    if (!lk || imageByLabel.has(lk)) continue;
    imageByLabel.set(lk, playlist.spotify_playlist_image_url ?? null);
  }

  const mapped = (rows?.labels ?? []).map((label) => ({
    label_key: String(label.label_key),
    display_name: String(label.display_name),
    accent_hex: label.accent_hex ? String(label.accent_hex).replace(/^#/, "").toLowerCase() : null,
    image_url: imageByLabel.get(String(label.label_key)) ?? null,
  }));

  return applyResolvedLabelAccents(mapped);
}

function buildTitleTemplate(datasetMode: DatasetMode, displayName: string | null): string {
  if (datasetMode !== "competitor") return "%s";
  if (displayName) return `%s \u00b7 ${displayName}`;
  return "%s \u00b7 Competitors";
}

export function buildCompetitorShellContext(args: {
  canUseCompetitor: boolean;
  datasetMode: unknown;
  savedCompetitorLabelKey: unknown;
  competitorLabels: CompetitorLabelWithImage[];
}): CompetitorShellContext {
  if (!args.canUseCompetitor) {
    return {
      datasetMode: "own",
      competitorLabels: [],
      competitorLabelKey: null,
      competitorAccentHex: null,
      competitorDisplayName: null,
      titleTemplate: "%s",
    };
  }

  const datasetMode = normalizeDatasetMode(args.datasetMode);
  const competitorLabels = args.competitorLabels;
  const competitorLabelKey = resolveCompetitorLabelKey(args.savedCompetitorLabelKey, competitorLabels);

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

  const competitorLabels = await loadCompetitorLabelsWithImages();
  return buildCompetitorShellContext({
    canUseCompetitor: true,
    datasetMode: settings?.dataset_mode,
    savedCompetitorLabelKey: settings?.competitor_label_key,
    competitorLabels,
  });
}
