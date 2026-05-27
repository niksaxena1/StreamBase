import { CACHE_TTL_1H } from "@/lib/constants";
import { cachedQuery } from "@/lib/supabase/cache";
import { supabaseService } from "@/lib/supabase/service";

export type SettingsTrackRow = {
  isrc: string;
  name: string | null;
  spotify_album_image_url: string | null;
  spotify_artist_names: string[] | null;
};

export type OverrideSuggestion = {
  isrc: string;
  code: "catalog_streams_missing_prev_nonzero" | "catalog_missing_stream_snapshots";
  suggestedStreams: number | null;
  prevStreams: number | null;
};

export type SettingsHeavyData = {
  allTracks: SettingsTrackRow[];
  unenrichedTracks: SettingsTrackRow[];
  overrideSuggestions: OverrideSuggestion[];
  exclusions: Array<{
    id: number;
    playlist_key: string | null;
    isrc: string;
    note: string | null;
    created_at: string | null;
  }>;
  enrichmentExclusions: Array<{
    id: number;
    playlist_key: string | null;
    isrc: string;
    note: string | null;
    created_at: string | null;
  }>;
  staleExclusions: Array<{
    id: number;
    playlist_key: string | null;
    isrc: string;
    note: string | null;
    created_at: string | null;
  }>;
  streamOverrides: Array<{
    id: number;
    date: string;
    isrc: string;
    streams_cumulative_override: number;
    note: string | null;
    created_by: string | null;
    created_at: string | null;
  }>;
};

async function fetchAllTracks(svc: ReturnType<typeof supabaseService>) {
  const allTracks: SettingsTrackRow[] = [];
  const pageSize = 1000;
  const hardCap = 20_000;
  let from = 0;
  while (from < hardCap) {
    const to = from + pageSize - 1;
    const { data, error } = await svc
      .from("tracks")
      .select("isrc,name,spotify_album_image_url,spotify_artist_names")
      .order("last_seen", { ascending: false })
      .range(from, to);
    if (error || !data || data.length === 0) break;
    allTracks.push(...(data as SettingsTrackRow[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return allTracks;
}

async function fetchUnenrichedTracks(svc: ReturnType<typeof supabaseService>) {
  const rows: SettingsTrackRow[] = [];
  const pageSize = 1000;
  const hardCap = 10_000;
  let from = 0;
  while (from < hardCap) {
    const to = from + pageSize - 1;
    const { data, error } = await svc
      .from("tracks")
      .select("isrc,name,spotify_album_image_url,spotify_artist_names")
      .is("spotify_artist_ids", null)
      .order("last_seen", { ascending: false })
      .range(from, to);
    if (error || !data || data.length === 0) break;
    rows.push(...(data as SettingsTrackRow[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

async function fetchOverrideSuggestions(svc: ReturnType<typeof supabaseService>, latestRunDate: string | null) {
  if (!latestRunDate) return [] as OverrideSuggestion[];

  const { data: warnRows, error } = await svc
    .from("ingestion_warnings")
    .select("code,details_json")
    .eq("run_date", latestRunDate)
    .in("code", ["catalog_streams_missing_prev_nonzero", "catalog_missing_stream_snapshots"])
    .limit(50);

  if (error) return [] as OverrideSuggestion[];

  const byIsrc = new Map<string, OverrideSuggestion>();
  for (const w of (warnRows ?? []) as Array<Record<string, unknown>>) {
    const code = String(w?.code ?? "") as OverrideSuggestion["code"];
    const d = (w?.details_json ?? {}) as Record<string, unknown>;

    if (code === "catalog_streams_missing_prev_nonzero") {
      const affectedRows = Array.isArray(d?.affected_isrcs_with_prev_sample)
        ? (d.affected_isrcs_with_prev_sample as Record<string, unknown>[])
        : [];
      for (const r of affectedRows) {
        const isrc = String(r?.isrc ?? "").trim().toUpperCase();
        const prev = Number(r?.prev_streams_cumulative ?? NaN);
        if (!/^[A-Z0-9]{12}$/.test(isrc)) continue;
        const prevStreams = Number.isFinite(prev) ? prev : null;
        byIsrc.set(isrc, { isrc, code, prevStreams, suggestedStreams: prevStreams });
      }
    }

    if (code === "catalog_missing_stream_snapshots") {
      const isrcs = Array.isArray(d?.missing_isrcs_sample) ? (d.missing_isrcs_sample as unknown[]) : [];
      for (const raw of isrcs) {
        const isrc = String(raw ?? "").trim().toUpperCase();
        if (!/^[A-Z0-9]{12}$/.test(isrc)) continue;
        if (byIsrc.has(isrc)) continue;
        byIsrc.set(isrc, { isrc, code, prevStreams: null, suggestedStreams: null });
      }
    }
  }

  return Array.from(byIsrc.values());
}

export async function loadSettingsHeavyData(latestRunDate: string | null): Promise<SettingsHeavyData> {
  const cached = await cachedQuery(
    async () => {
      const svc = supabaseService();
      const exclusionCode = "non_catalog_tracks_present";
      const enrichmentExclusionCode = "tracks_missing_enrichment";
      const staleExclusionCode = "individual_tracks_stale";

      const [allTracks, unenrichedTracks, overrideSuggestions] = await Promise.all([
        fetchAllTracks(svc),
        fetchUnenrichedTracks(svc),
        fetchOverrideSuggestions(svc, latestRunDate),
      ]);

      let exclusions: SettingsHeavyData["exclusions"] = [];
      let enrichmentExclusions: SettingsHeavyData["enrichmentExclusions"] = [];
      let staleExclusions: SettingsHeavyData["staleExclusions"] = [];

      try {
        const { data: exRows, error: exErr } = await svc
          .from("health_warning_exclusions")
          .select("id,playlist_key,isrc,note,created_at")
          .eq("code", exclusionCode)
          .order("created_at", { ascending: false })
          .limit(500);
        if (!exErr) exclusions = (exRows ?? []) as SettingsHeavyData["exclusions"];
      } catch {
        // ignore
      }

      try {
        const { data: exRows, error: exErr } = await svc
          .from("health_warning_exclusions")
          .select("id,playlist_key,isrc,note,created_at")
          .eq("code", enrichmentExclusionCode)
          .order("created_at", { ascending: false })
          .limit(500);
        if (!exErr) enrichmentExclusions = (exRows ?? []) as SettingsHeavyData["enrichmentExclusions"];
      } catch {
        // ignore
      }

      try {
        const { data: exRows, error: exErr } = await svc
          .from("health_warning_exclusions")
          .select("id,playlist_key,isrc,note,created_at")
          .eq("code", staleExclusionCode)
          .order("created_at", { ascending: false })
          .limit(500);
        if (!exErr) staleExclusions = (exRows ?? []) as SettingsHeavyData["staleExclusions"];
      } catch {
        // ignore
      }

      const streamOverrides: SettingsHeavyData["streamOverrides"] = [];
      try {
        const pageSize = 1000;
        const hardCap = 50_000;
        let from = 0;
        while (from < hardCap) {
          const to = from + pageSize - 1;
          const { data: rows, error } = await svc
            .from("track_daily_stream_overrides")
            .select("id,date,isrc,streams_cumulative_override,note,created_by,created_at")
            .order("date", { ascending: false })
            .order("created_at", { ascending: false })
            .range(from, to);
          if (error || !rows || rows.length === 0) break;
          streamOverrides.push(...(rows as SettingsHeavyData["streamOverrides"]));
          if (rows.length < pageSize) break;
          from += pageSize;
        }
      } catch {
        // ignore
      }

      return {
        data: {
          allTracks,
          unenrichedTracks,
          overrideSuggestions,
          exclusions,
          enrichmentExclusions,
          staleExclusions,
          streamOverrides,
        },
        error: null,
      };
    },
    `settings-heavy-${latestRunDate ?? "none"}`,
    CACHE_TTL_1H,
  );

  return (
    cached.data ?? {
      allTracks: [],
      unenrichedTracks: [],
      overrideSuggestions: [],
      exclusions: [],
      enrichmentExclusions: [],
      staleExclusions: [],
      streamOverrides: [],
    }
  );
}
