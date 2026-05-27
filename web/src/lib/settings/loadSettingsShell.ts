import { CACHE_TTL_1H } from "@/lib/constants";
import { dataDateFromRunDate } from "@/lib/sotDates";
import { cachedQuery } from "@/lib/supabase/cache";
import { supabaseService } from "@/lib/supabase/service";

export type SettingsShellData = {
  latestRunDate: string | null;
  earliestDataDate: string | null;
  latestDataDate: string | null;
  runDateOptions: string[];
  allPlaylists: Array<{ playlist_key: string; display_name: string }>;
  exclusionCount: number;
  streamOverrideCount: number;
};

export async function loadSettingsShell(): Promise<SettingsShellData> {
  const svc = supabaseService();

  const cached = await cachedQuery(
    async () => {
      const { data: latestRun } = await svc
        .from("ingestion_runs")
        .select("run_date")
        .order("run_date", { ascending: false })
        .limit(1)
        .maybeSingle();

      const latestRunDate = (latestRun?.run_date as string | null) ?? null;

      let earliestDataDate: string | null = null;
      let latestDataDate: string | null = null;
      try {
        const [earliestResult, latestResult] = await Promise.all([
          svc
            .from("track_daily_streams_effective_public")
            .select("date")
            .order("date", { ascending: true })
            .limit(1)
            .maybeSingle(),
          svc
            .from("track_daily_streams_effective_public")
            .select("date")
            .order("date", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);
        const earliestRunDate = String(earliestResult.data?.date ?? "").trim();
        const latestSnapshotRunDate = String(latestResult.data?.date ?? "").trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(earliestRunDate)) {
          earliestDataDate = dataDateFromRunDate(earliestRunDate);
        }
        if (/^\d{4}-\d{2}-\d{2}$/.test(latestSnapshotRunDate)) {
          latestDataDate = dataDateFromRunDate(latestSnapshotRunDate);
        }
      } catch {
        // ignore
      }

      if (!latestDataDate && latestRunDate) {
        latestDataDate = dataDateFromRunDate(latestRunDate);
      }

      let runDateOptions: string[] = [];
      try {
        const { data: runRows, error: runErr } = await svc
          .from("ingestion_runs")
          .select("run_date")
          .order("run_date", { ascending: false })
          .limit(730);
        if (!runErr) {
          runDateOptions = ((runRows ?? []) as Array<{ run_date?: string }>)
            .map((r) => String(r?.run_date ?? "").trim())
            .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
        }
      } catch {
        // ignore
      }

      let allPlaylists: Array<{ playlist_key: string; display_name: string }> = [];
      try {
        const { data, error } = await svc
          .from("playlists")
          .select("playlist_key,display_name")
          .order("display_name", { ascending: true })
          .limit(2000);
        if (!error && data) allPlaylists = data as typeof allPlaylists;
      } catch {
        // ignore
      }

      let exclusionCount = 0;
      try {
        const { count } = await svc
          .from("health_warning_exclusions")
          .select("id", { count: "exact", head: true });
        exclusionCount = count ?? 0;
      } catch {
        // ignore
      }

      let streamOverrideCount = 0;
      try {
        const { count } = await svc
          .from("track_daily_stream_overrides")
          .select("id", { count: "exact", head: true });
        streamOverrideCount = count ?? 0;
      } catch {
        // ignore
      }

      return {
        data: {
          latestRunDate,
          earliestDataDate,
          latestDataDate,
          runDateOptions,
          allPlaylists,
          exclusionCount,
          streamOverrideCount,
        },
        error: null,
      };
    },
    "settings-shell",
    CACHE_TTL_1H,
  );

  return (
    cached.data ?? {
      latestRunDate: null,
      earliestDataDate: null,
      latestDataDate: null,
      runDateOptions: [],
      allPlaylists: [],
      exclusionCount: 0,
      streamOverrideCount: 0,
    }
  );
}
