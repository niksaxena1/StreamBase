import { redirect } from "next/navigation";

import { CACHE_TTL_1H } from "@/lib/constants";
import { normalizeDatasetMode } from "@/lib/datasetMode";
import { addDaysISO, dataDateFromRunDate, SOT_DATA_LAG_DAYS } from "@/lib/sotDates";
import type { PlaylistMeta } from "@/lib/health/types";
import { cachedQuery } from "@/lib/supabase/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export type HealthShellData = {
  mode: "own" | "competitor";
  latestRunDate: string | null;
  latestDataDate: string | null;
  selectedDataDate: string | null;
  selectedRunDate: string | null;
  selectedRunId: string | null;
  playlistMeta: Record<string, PlaylistMeta>;
  runs: Array<Record<string, unknown>>;
  runsError: string | null;
  exportsForLatest: Array<Record<string, unknown>>;
  exportsError: string | null;
  healthConfigRows: Array<Record<string, unknown>>;
};

export async function loadHealthPageShell(args: {
  dateFilter?: string | null;
}): Promise<HealthShellData> {
  const sb = await supabaseServer();
  const { data: userData } = await sb.auth.getUser();
  if (!userData.user) redirect("/login");
  const { data: isAdmin } = await sb.rpc("is_admin");
  if (!isAdmin) redirect("/");

  const svc = supabaseService();

  const { data: settings } = await svc
    .from("user_settings")
    .select("dataset_mode")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  const mode = normalizeDatasetMode(settings?.dataset_mode) === "competitor" ? "competitor" : "own";

  if (mode === "competitor") {
    return {
      mode: "competitor",
      latestRunDate: null,
      latestDataDate: null,
      selectedDataDate: null,
      selectedRunDate: null,
      selectedRunId: null,
      playlistMeta: {},
      runs: [],
      runsError: null,
      exportsForLatest: [],
      exportsError: null,
      healthConfigRows: [],
    };
  }

  const cached = await cachedQuery(
    async () => {
      const [runsResult, playlistsResult, healthConfigResult] = await Promise.all([
        svc
          .from("ingestion_runs")
          .select("id,run_date,status,logs_url,started_at,finished_at")
          .order("run_date", { ascending: false })
          .limit(30),
        svc
          .from("playlists")
          .select("playlist_key,display_name,spotify_playlist_image_url")
          .order("display_name", { ascending: true })
          .limit(2000),
        svc
          .from("health_config")
          .select("key,value_numeric,description,updated_at")
          .order("key", { ascending: true })
          .limit(100),
      ]);

      if (runsResult.error) {
        return { data: null, error: runsResult.error };
      }

      const playlistMeta: Record<string, PlaylistMeta> = {};
      for (const row of (playlistsResult.data ?? []) as Array<Record<string, unknown>>) {
        const key = String(row.playlist_key ?? "").trim();
        if (!key) continue;
        playlistMeta[key] = {
          name: String(row.display_name ?? "").trim() || key,
          imageUrl: (row.spotify_playlist_image_url ?? null) as string | null,
        };
      }

      return {
        data: {
          runs: (runsResult.data ?? []) as Array<Record<string, unknown>>,
          playlistMeta,
          healthConfigRows: (healthConfigResult.data ?? []) as Array<Record<string, unknown>>,
        },
        error: null,
      };
    },
    "health-shell-own",
    CACHE_TTL_1H,
  );

  const runs = cached.data?.runs ?? [];
  const latestRunDate = (runs[0]?.run_date as string | undefined) ?? null;
  const latestDataDate = latestRunDate ? dataDateFromRunDate(latestRunDate) : null;
  const selectedDataDate = args.dateFilter ?? latestDataDate;
  const selectedRunDate = selectedDataDate ? addDaysISO(selectedDataDate, SOT_DATA_LAG_DAYS) : latestRunDate;
  const selectedRun = runs.find((r) => r.run_date === selectedRunDate);
  const selectedRunId = (selectedRun?.id as string | undefined) ?? null;

  let exportsForLatest: Array<Record<string, unknown>> = [];
  let exportsError: string | null = null;
  if (selectedRunId) {
    const exportsResult = await cachedQuery(
      async () =>
        await svc
          .from("raw_exports")
          .select("playlist_key,storage_bucket,object_key,rows_count,file_sha256,exported_at")
          .eq("run_id", selectedRunId)
          .order("playlist_key", { ascending: true }),
      `health-exports-${selectedRunId}`,
      CACHE_TTL_1H,
    );
    exportsForLatest = (exportsResult.data ?? []) as Array<Record<string, unknown>>;
    exportsError = exportsResult.error?.message ?? null;
  }

  return {
    mode: "own",
    latestRunDate,
    latestDataDate,
    selectedDataDate,
    selectedRunDate,
    selectedRunId,
    playlistMeta: cached.data?.playlistMeta ?? {},
    runs,
    runsError: cached.error?.message ?? null,
    exportsForLatest,
    exportsError,
    healthConfigRows: cached.data?.healthConfigRows ?? [],
  };
}
