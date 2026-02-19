import Link from "next/link";
import { redirect } from "next/navigation";

import { formatDateISO } from "@/lib/format";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { getActiveWarningSummary, normalizeKey } from "@/lib/health/activeWarnings";
import { GlassTable, TableRow, TableCell, EmptyState } from "@/components/ui/GlassTable";
import { WarningRow } from "@/components/health/WarningRow";
import { ArtistLinks } from "@/components/ui/ArtistLinks";
import { ExportMissingTracksButton } from "@/components/health/ExportMissingTracksButton";
import { RefreshButton } from "@/components/health/RefreshButton";
import { BatchInterpolateTool } from "@/components/health/BatchInterpolateTool";
import { WarningHistoryChart } from "@/components/health/WarningHistoryChart";
import { PageHeader } from "@/components/shell/PageHeader";
import { addDaysISO, dataDateFromRunDate, SOT_DATA_LAG_DAYS } from "@/lib/sotDates";
import { Alert } from "@/components/ui/Alert";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";

export const revalidate = 60; // Revalidate every 60 seconds for fresher health data

type HealthPageProps = {
  // Next.js 16 types `searchParams` as a Promise in generated PageProps.
  // Accept that shape here and resolve it inside the component.
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function HealthPage({ searchParams }: HealthPageProps) {
  const sp = (await searchParams) ?? {};
  const getFirst = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  const dateFilter = getFirst(sp.date);

  const sb = await supabaseServer();
  const { data: userData } = await sb.auth.getUser();
  if (!userData.user) redirect("/login");

  const { data: isAdmin } = await sb.rpc("is_admin");
  if (!isAdmin) redirect("/");

  const svc = supabaseService();

  // Health warning exclusions (best-effort; table may not exist yet).
  // Used to suppress intentional "non-catalog" tracks from warning calculations.
  const exclusionCode = "non_catalog_tracks_present";
  const enrichmentExclusionCode = "tracks_missing_enrichment";

  const excludedGlobal = new Set<string>();
  const excludedByPlaylist = new Map<string, Set<string>>();

  const excludedEnrichmentGlobal = new Set<string>();
  const excludedEnrichmentByPlaylist = new Map<string, Set<string>>();

  try {
    const { data: exclusionRows, error: exclusionErr } = await svc
      .from("health_warning_exclusions")
      .select("playlist_key,isrc")
      .eq("code", exclusionCode)
      .limit(2000);

    if (!exclusionErr) {
      for (const r of exclusionRows ?? []) {
        const row = (r ?? {}) as Record<string, unknown>;
        const isrc = String(row.isrc ?? "").trim().toUpperCase();
        const playlist_key = String(row.playlist_key ?? "").trim();
        if (!isrc) continue;
        if (!playlist_key) {
          excludedGlobal.add(isrc);
        } else {
          if (!excludedByPlaylist.has(playlist_key)) excludedByPlaylist.set(playlist_key, new Set());
          excludedByPlaylist.get(playlist_key)!.add(isrc);
        }
      }
    }
  } catch {
    // ignore
  }

  try {
    const { data: exclusionRows, error: exclusionErr } = await svc
      .from("health_warning_exclusions")
      .select("playlist_key,isrc")
      .eq("code", enrichmentExclusionCode)
      .limit(2000);

    if (!exclusionErr) {
      for (const r of exclusionRows ?? []) {
        const row = (r ?? {}) as Record<string, unknown>;
        const isrc = String(row.isrc ?? "").trim().toUpperCase();
        const playlist_key = String(row.playlist_key ?? "").trim();
        if (!isrc) continue;
        if (!playlist_key) {
          excludedEnrichmentGlobal.add(isrc);
        } else {
          if (!excludedEnrichmentByPlaylist.has(playlist_key))
            excludedEnrichmentByPlaylist.set(playlist_key, new Set());
          excludedEnrichmentByPlaylist.get(playlist_key)!.add(isrc);
        }
      }
    }
  } catch {
    // ignore
  }

  function isExcluded(playlist_key: string, isrc: string) {
    if (!isrc) return false;
    if (excludedGlobal.has(isrc)) return true;
    const s = excludedByPlaylist.get(playlist_key);
    return Boolean(s && s.has(isrc));
  }

  function isExcludedEnrichment(playlist_key: string, isrc: string) {
    if (!isrc) return false;
    if (excludedEnrichmentGlobal.has(isrc)) return true;
    const s = excludedEnrichmentByPlaylist.get(playlist_key);
    return Boolean(s && s.has(isrc));
  }

  const exclusionsEnabled = excludedGlobal.size > 0 || excludedByPlaylist.size > 0;
  const enrichmentExclusionsEnabled =
    excludedEnrichmentGlobal.size > 0 || excludedEnrichmentByPlaylist.size > 0;

  const { data: runs, error: runsErr } = await svc
    .from("ingestion_runs")
    .select("id,run_date,status,logs_url,started_at,finished_at")
    .order("run_date", { ascending: false })
    .limit(30);

  // UI uses "data date" (SpotOnTrack lag), DB stores "run_date" as ingestion snapshot date.
  const latestRunDate = runs?.[0]?.run_date ?? null;
  const latestDataDate = latestRunDate ? dataDateFromRunDate(latestRunDate) : null;
  const selectedDataDate = dateFilter ?? latestDataDate;
  const selectedRunDate = selectedDataDate
    ? addDaysISO(selectedDataDate, SOT_DATA_LAG_DAYS)
    : latestRunDate;

  // Get run ID for selected run date
  const selectedRun = runs?.find((r) => r.run_date === selectedRunDate);
  const selectedRunId = selectedRun?.id ?? null;

  const { data: exportsForLatest, error: exportsErr } = selectedRunId
    ? await svc
        .from("raw_exports")
        .select("playlist_key,storage_bucket,object_key,rows_count,file_sha256,exported_at")
        .eq("run_id", selectedRunId)
        .order("playlist_key", { ascending: true })
    : { data: [], error: null };

  // Fetch filtered warnings via shared cached function (limit 2000, exclusions applied).
  // The shared function applies the same suppression logic used by the badge components,
  // ensuring badge count === displayed warning count.
  const { warnings } = await getActiveWarningSummary(
    selectedRunDate ?? undefined,
  );

  function severityRank(severity: string) {
    switch ((severity ?? "").trim()) {
      case "critical":
        return 0;
      case "warn":
        return 1;
      case "info":
        return 2;
      default:
        return 99;
    }
  }

  // Playlist metadata (for name + thumbnail display).
  // Fetch all playlists — table is small and drift sections need source playlist metadata too.
  const playlistMetaByKey = new Map<string, { name: string; imageUrl: string | null }>();
  {
    const { data: plRows } = await svc
      .from("playlists")
      .select("playlist_key,display_name,spotify_playlist_image_url")
      .limit(2000);

    for (const r of plRows ?? []) {
      const row = (r ?? {}) as Record<string, unknown>;
      const key = String(row.playlist_key ?? "").trim();
      if (!key) continue;
      const name = String(row.display_name ?? "").trim() || key;
      const imageUrl = (row.spotify_playlist_image_url ?? null) as string | null;
      playlistMetaByKey.set(key, { name, imageUrl });
    }
  }

  // Serializable version for client components (Maps don't transfer across the wire).
  const allPlaylistMeta: Record<string, { name: string; imageUrl: string | null }> =
    Object.fromEntries(playlistMetaByKey.entries());

  // Fetch non-catalog tracks for warnings of type "non_catalog_tracks_present"
  const nonCatalogWarnings = warnings.filter(
    (w) => w.code === "non_catalog_tracks_present" && w.playlist_key && selectedRunDate
  );

  const nonCatalogTracksMap = new Map<
    string,
    Array<{
      isrc: string;
      name: string | null;
      artist_names?: string[] | null;
      artist_ids?: string[] | null;
      album_image_url?: string | null;
    }>
  >();

  if (nonCatalogWarnings.length > 0 && selectedRunDate) {
    // Parallelize RPC calls instead of sequential loop (fixes N+1 pattern).
    await Promise.all(nonCatalogWarnings.map(async (warning) => {
      if (!warning.playlist_key) return;
      const { data: rows, error } = await svc.rpc("health_playlist_missing_catalog_tracks", {
        playlist_key: warning.playlist_key,
        run_date: selectedRunDate,
      });

      if (error) {
        console.error("health_playlist_missing_catalog_tracks RPC failed:", error);
        return;
      }

      const nonCatalogTracks: Array<{
        isrc: string;
        name: string | null;
        artist_names: string[] | null;
        artist_ids: string[] | null;
        album_image_url: string | null;
      }> = (rows ?? []).map((t: unknown) => {
        const row = (t ?? {}) as Record<string, unknown>;
        return {
          isrc: String(row.isrc ?? "").trim().toUpperCase(),
          name: (row.name ?? null) as string | null,
          artist_names: (row.artist_names ?? null) as string[] | null,
          artist_ids: (row.artist_ids ?? null) as string[] | null,
          album_image_url: (row.album_image_url ?? null) as string | null,
        };
      });

      nonCatalogTracksMap.set(
        warning.playlist_key ?? "",
        exclusionsEnabled
          ? nonCatalogTracks.filter((t) => !isExcluded(warning.playlist_key!, t.isrc))
          : nonCatalogTracks,
      );
    }));
  }

  // Fetch added/removed tracks for track_count_swing warnings
  const trackCountSwingWarnings = warnings.filter(
    (w) => w.code === "track_count_swing" && w.playlist_key && selectedRunDate
  );

  const trackCountSwingTracksMap = new Map<
    string,
    {
      added: Array<{
        isrc: string;
        name: string | null;
        artist_names?: string[] | null;
        artist_ids?: string[] | null;
        album_image_url?: string | null;
      }>;
      removed: Array<{
        isrc: string;
        name: string | null;
        artist_names?: string[] | null;
        artist_ids?: string[] | null;
        album_image_url?: string | null;
      }>;
    }
  >();

  if (trackCountSwingWarnings.length > 0 && selectedRunDate) {
    // Parallelize RPC calls instead of sequential loop (fixes N+1 pattern).
    await Promise.all(trackCountSwingWarnings.map(async (warning) => {
      if (!warning.playlist_key) return;
      const { data: rows, error } = await svc.rpc("health_track_count_swing_tracks", {
        playlist_key: warning.playlist_key,
        run_date: selectedRunDate,
      });

      if (error) {
        console.error("health_track_count_swing_tracks RPC failed:", error);
        return;
      }

      const changeRows = (rows ?? []) as unknown[];

      const added: Array<{
        isrc: string;
        name: string | null;
        artist_names?: string[] | null;
        artist_ids?: string[] | null;
        album_image_url?: string | null;
      }> = changeRows
        .filter((r) => String(((r ?? {}) as Record<string, unknown>).change_type ?? "") === "added")
        .map((r) => {
          const row = (r ?? {}) as Record<string, unknown>;
          return {
            isrc: String(row.isrc ?? "").trim().toUpperCase(),
            name: (row.name ?? null) as string | null,
            artist_names: (row.artist_names ?? null) as string[] | null,
            artist_ids: (row.artist_ids ?? null) as string[] | null,
            album_image_url: (row.album_image_url ?? null) as string | null,
          };
        });

      const removed: Array<{
        isrc: string;
        name: string | null;
        artist_names?: string[] | null;
        artist_ids?: string[] | null;
        album_image_url?: string | null;
      }> = changeRows
        .filter((r) => String(((r ?? {}) as Record<string, unknown>).change_type ?? "") === "removed")
        .map((r) => {
          const row = (r ?? {}) as Record<string, unknown>;
          return {
            isrc: String(row.isrc ?? "").trim().toUpperCase(),
            name: (row.name ?? null) as string | null,
            artist_names: (row.artist_names ?? null) as string[] | null,
            artist_ids: (row.artist_ids ?? null) as string[] | null,
            album_image_url: (row.album_image_url ?? null) as string | null,
          };
        });

      trackCountSwingTracksMap.set(warning.playlist_key ?? "", { added, removed });
    }));
  }

  // Fetch missing enrichment tracks for warnings
  const missingEnrichmentWarnings = warnings.filter(
    (w) => w.code === "tracks_missing_enrichment" && w.playlist_key && selectedRunDate
  );

  const missingEnrichmentTracksMap = new Map<
    string,
    Array<{
      isrc: string;
      name: string | null;
      artist_names?: string[] | null;
      artist_ids?: string[] | null;
      album_image_url?: string | null;
    }> | null
  >();

  if (missingEnrichmentWarnings.length > 0 && selectedRunDate) {
    // Parallelize instead of sequential loop (fixes N+1 pattern).
    await Promise.all(missingEnrichmentWarnings.map(async (warning) => {
      if (!warning.playlist_key) return;
      const isrcList = warning.details_json?.isrc_list ?? [];
      
      // If we have ISRCs, fetch their details
      if (Array.isArray(isrcList) && isrcList.length > 0) {
        const filteredIsrcs = enrichmentExclusionsEnabled
          ? (isrcList as unknown[])
              .map((x) => String(x ?? "").trim().toUpperCase().replace(/\s+/g, ""))
              .filter(Boolean)
              .filter((isrc) => !isExcludedEnrichment(warning.playlist_key!, isrc))
          : isrcList;

        if (Array.isArray(filteredIsrcs) && filteredIsrcs.length === 0) {
          missingEnrichmentTracksMap.set(warning.playlist_key ?? "", []);
          return;
        }

        // Only fetch tracks that are STILL missing enrichment (spotify_artist_ids IS NULL).
        // The stored isrc_list is a snapshot from ingestion time — tracks may have been
        // enriched since then, so we re-check at query time.
        const { data: rows, error } = await svc
          .from("tracks")
          .select("isrc,name,spotify_artist_names,spotify_artist_ids,spotify_album_image_url")
          .in("isrc", filteredIsrcs)
          .is("spotify_artist_ids", null);

        if (error) {
          console.error("Failed to fetch missing enrichment tracks:", error);
          missingEnrichmentTracksMap.set(warning.playlist_key, null);
          return;
        }

        const tracksRaw: Array<{
          isrc: string;
          name: string | null;
          artist_names?: string[] | null;
          artist_ids?: string[] | null;
          album_image_url?: string | null;
        }> = (rows ?? []).map((t: unknown) => {
          const row = (t ?? {}) as Record<string, unknown>;
          return {
            isrc: String(row.isrc ?? "").trim().toUpperCase(),
            name: (row.name ?? null) as string | null,
            artist_names: (row.spotify_artist_names ?? null) as string[] | null,
            artist_ids: (row.spotify_artist_ids ?? null) as string[] | null,
            album_image_url: (row.spotify_album_image_url ?? null) as string | null,
          };
        });
        // Apply user-configured exclusions on top of the DB-level enrichment filter.
        const tracks = tracksRaw.filter((t) => !isExcludedEnrichment(warning.playlist_key!, t.isrc));
        missingEnrichmentTracksMap.set(warning.playlist_key ?? "", tracks);
      } else {
        // Fallback for older warnings: compute affected tracks from membership snapshot
        const { data: rows, error } = await svc.rpc("health_playlist_missing_enrichment_tracks", {
          playlist_key: warning.playlist_key,
          run_date: selectedRunDate,
          limit_rows: 200,
        });

        if (error) {
          console.error("health_playlist_missing_enrichment_tracks RPC failed:", error);
          missingEnrichmentTracksMap.set(warning.playlist_key, null);
          return;
        }

        const tracksRaw: Array<{
          isrc: string;
          name: string | null;
          artist_names: string[] | null;
          artist_ids: string[] | null;
          album_image_url: string | null;
        }> = (rows ?? []).map((t: unknown) => {
          const row = (t ?? {}) as Record<string, unknown>;
          return {
            isrc: String(row.isrc ?? "").trim().toUpperCase(),
            name: (row.name ?? null) as string | null,
            artist_names: (row.artist_names ?? null) as string[] | null,
            artist_ids: (row.artist_ids ?? null) as string[] | null,
            album_image_url: (row.album_image_url ?? null) as string | null,
          };
        });
        // RPC already filters by spotify_artist_ids IS NULL; apply user exclusions on top.
        const tracks = tracksRaw.filter((t) => !isExcludedEnrichment(warning.playlist_key!, t.isrc));
        missingEnrichmentTracksMap.set(warning.playlist_key ?? "", tracks);
      }
    }));
  }

  // Fetch missing catalog stream snapshot tracks for warning `catalog_missing_stream_snapshots`
  // This warning is global (playlist_key = "all_catalog") and contains an ISRC sample list in details_json.
  const catalogMissingStreamSnapshotTracksByKey = new Map<
    string,
    Array<{
      isrc: string;
      name: string | null;
      artist_names?: string[] | null;
      artist_ids?: string[] | null;
      album_image_url?: string | null;
    }> | null
  >();

  const catalogMissingSnapshotWarnings = warnings.filter(
    (w) => w.code === "catalog_missing_stream_snapshots" && selectedRunDate
  );

  if (catalogMissingSnapshotWarnings.length > 0) {
    for (const w of catalogMissingSnapshotWarnings) {
      const key = String(w.playlist_key ?? "global");
      const raw = (w as any)?.details_json?.missing_isrcs_sample;
      const isrcs = Array.isArray(raw)
        ? (raw as unknown[])
            .map((x) => String(x ?? "").trim().toUpperCase().replace(/\s+/g, ""))
            .filter(Boolean)
            .slice(0, 200)
        : [];

      if (isrcs.length === 0) {
        // Still allow expansion to show the note.
        catalogMissingStreamSnapshotTracksByKey.set(key, null);
        continue;
      }

      const { data: rows, error } = await svc
        .from("tracks")
        .select("isrc,name,spotify_artist_names,spotify_artist_ids,spotify_album_image_url")
        .in("isrc", isrcs);

      if (error) {
        console.error("Failed to fetch catalog_missing_stream_snapshots tracks:", error);
        catalogMissingStreamSnapshotTracksByKey.set(key, null);
        continue;
      }

      const tracks: Array<{
        isrc: string;
        name: string | null;
        artist_names?: string[] | null;
        artist_ids?: string[] | null;
        album_image_url?: string | null;
      }> = (rows ?? []).map((t: unknown) => {
        const row = (t ?? {}) as Record<string, unknown>;
        return {
          isrc: String(row.isrc ?? "").trim().toUpperCase(),
          name: (row.name ?? null) as string | null,
          artist_names: (row.spotify_artist_names ?? null) as string[] | null,
          artist_ids: (row.spotify_artist_ids ?? null) as string[] | null,
          album_image_url: (row.spotify_album_image_url ?? null) as string | null,
        };
      });

      // Preserve the ordering of the sample ISRC list
      const idx = new Map(isrcs.map((isrc, i) => [isrc, i]));
      tracks.sort((a, b) => (idx.get(a.isrc) ?? 999999) - (idx.get(b.isrc) ?? 999999));

      catalogMissingStreamSnapshotTracksByKey.set(key, tracks);
    }
  }

  // Fetch tracks for warning `catalog_streams_missing_prev_nonzero`
  // This warning is global (playlist_key = "all_catalog") and contains objects in details_json:
  // { isrc, prev_streams_cumulative } under `affected_isrcs_with_prev_sample`.
  const catalogStreamsMissingPrevNonzeroTracksByKey = new Map<
    string,
    Array<{
      isrc: string;
      name: string | null;
      artist_names?: string[] | null;
      artist_ids?: string[] | null;
      album_image_url?: string | null;
      prev_streams_cumulative?: number | null;
    }> | null
  >();

  const catalogStreamsMissingPrevNonzeroWarnings = warnings.filter(
    (w) => w.code === "catalog_streams_missing_prev_nonzero" && selectedRunDate
  );

  if (catalogStreamsMissingPrevNonzeroWarnings.length > 0) {
    for (const w of catalogStreamsMissingPrevNonzeroWarnings) {
      const key = String(w.playlist_key ?? "global");
      const raw = (w as any)?.details_json?.affected_isrcs_with_prev_sample;
      const rows = Array.isArray(raw) ? (raw as unknown[]) : [];

      const sample = rows
        .map((r) => {
          const row = (r ?? {}) as Record<string, unknown>;
          const isrc = String(row.isrc ?? "").trim().toUpperCase().replace(/\s+/g, "");
          const prev = Number(row.prev_streams_cumulative ?? NaN);
          const prev_streams_cumulative = Number.isFinite(prev) ? prev : null;
          return { isrc, prev_streams_cumulative };
        })
        .filter((r) => Boolean(r.isrc))
        .slice(0, 200);

      const isrcs = sample.map((s) => s.isrc);
      if (isrcs.length === 0) {
        catalogStreamsMissingPrevNonzeroTracksByKey.set(key, null);
        continue;
      }

      const { data: trackRows, error } = await svc
        .from("tracks")
        .select("isrc,name,spotify_artist_names,spotify_artist_ids,spotify_album_image_url")
        .in("isrc", isrcs);

      if (error) {
        console.error("Failed to fetch catalog_streams_missing_prev_nonzero tracks:", error);
        catalogStreamsMissingPrevNonzeroTracksByKey.set(key, null);
        continue;
      }

      const metaByIsrc = new Map<
        string,
        {
          isrc: string;
          name: string | null;
          artist_names: string[] | null;
          artist_ids: string[] | null;
          album_image_url: string | null;
        }
      >(
        (trackRows ?? []).map((t: any) => [
          String(t?.isrc ?? "").trim().toUpperCase(),
          {
            isrc: String(t?.isrc ?? "").trim().toUpperCase(),
            name: (t?.name ?? null) as string | null,
            artist_names: (t?.spotify_artist_names ?? null) as string[] | null,
            artist_ids: (t?.spotify_artist_ids ?? null) as string[] | null,
            album_image_url: (t?.spotify_album_image_url ?? null) as string | null,
          },
        ]),
      );

      const tracks = sample.map((s) => {
        const meta = metaByIsrc.get(s.isrc) ?? null;
        return {
          isrc: s.isrc,
          name: meta?.name ?? null,
          artist_names: meta?.artist_names ?? null,
          artist_ids: meta?.artist_ids ?? null,
          album_image_url: meta?.album_image_url ?? null,
          prev_streams_cumulative: s.prev_streams_cumulative ?? null,
        };
      });

      catalogStreamsMissingPrevNonzeroTracksByKey.set(key, tracks);
    }
  }

  // Fetch tracks for warning `individual_tracks_stale`
  // This warning contains { isrc, streams_cumulative } under `affected_tracks` in details_json.
  const individualTracksStaleByKey = new Map<
    string,
    Array<{
      isrc: string;
      name: string | null;
      artist_names?: string[] | null;
      artist_ids?: string[] | null;
      album_image_url?: string | null;
      streams_cumulative?: number | null;
    }> | null
  >();

  const individualTracksStaleWarnings = warnings.filter(
    (w) => w.code === "individual_tracks_stale" && selectedRunDate
  );

  if (individualTracksStaleWarnings.length > 0) {
    for (const w of individualTracksStaleWarnings) {
      const key = String(w.playlist_key ?? "global");
      const raw = (w as any)?.details_json?.affected_tracks;
      const rows = Array.isArray(raw) ? (raw as unknown[]) : [];

      const sample = rows
        .map((r) => {
          const row = (r ?? {}) as Record<string, unknown>;
          const isrc = String(row.isrc ?? "").trim().toUpperCase().replace(/\s+/g, "");
          const streams = Number(row.streams_cumulative ?? NaN);
          const streams_cumulative = Number.isFinite(streams) ? streams : null;
          return { isrc, streams_cumulative };
        })
        .filter((r) => Boolean(r.isrc))
        .slice(0, 200);

      const isrcs = sample.map((s) => s.isrc);
      if (isrcs.length === 0) {
        individualTracksStaleByKey.set(key, null);
        continue;
      }

      const { data: trackRows, error } = await svc
        .from("tracks")
        .select("isrc,name,spotify_artist_names,spotify_artist_ids,spotify_album_image_url")
        .in("isrc", isrcs);

      if (error) {
        console.error("Failed to fetch individual_tracks_stale tracks:", error);
        individualTracksStaleByKey.set(key, null);
        continue;
      }

      const metaByIsrc = new Map<
        string,
        {
          isrc: string;
          name: string | null;
          artist_names: string[] | null;
          artist_ids: string[] | null;
          album_image_url: string | null;
        }
      >(
        (trackRows ?? []).map((t: any) => [
          String(t?.isrc ?? "").trim().toUpperCase(),
          {
            isrc: String(t?.isrc ?? "").trim().toUpperCase(),
            name: (t?.name ?? null) as string | null,
            artist_names: (t?.spotify_artist_names ?? null) as string[] | null,
            artist_ids: (t?.spotify_artist_ids ?? null) as string[] | null,
            album_image_url: (t?.spotify_album_image_url ?? null) as string | null,
          },
        ]),
      );

      const tracks = sample.map((s) => {
        const meta = metaByIsrc.get(s.isrc) ?? null;
        return {
          isrc: s.isrc,
          name: meta?.name ?? null,
          artist_names: meta?.artist_names ?? null,
          artist_ids: meta?.artist_ids ?? null,
          album_image_url: meta?.album_image_url ?? null,
          streams_cumulative: s.streams_cumulative ?? null,
        };
      });

      individualTracksStaleByKey.set(key, tracks);
    }
  }

  // Fetch tracks for warning `excluded_track_streams_zeroed`
  // This warning contains { isrc, prev_streams } under `affected_tracks` in details_json.
  const excludedTracksZeroedByKey = new Map<
    string,
    Array<{
      isrc: string;
      name: string | null;
      artist_names?: string[] | null;
      artist_ids?: string[] | null;
      album_image_url?: string | null;
      prev_streams?: number | null;
    }> | null
  >();

  const excludedTracksZeroedWarnings = warnings.filter(
    (w) => w.code === "excluded_track_streams_zeroed" && selectedRunDate
  );

  if (excludedTracksZeroedWarnings.length > 0) {
    for (const w of excludedTracksZeroedWarnings) {
      const key = String(w.playlist_key ?? "global");
      const raw = (w as any)?.details_json?.affected_tracks;
      const rows = Array.isArray(raw) ? (raw as unknown[]) : [];

      const sample = rows
        .map((r) => {
          const row = (r ?? {}) as Record<string, unknown>;
          const isrc = String(row.isrc ?? "").trim().toUpperCase().replace(/\s+/g, "");
          const prev = Number(row.prev_streams ?? NaN);
          const prev_streams = Number.isFinite(prev) ? prev : null;
          return { isrc, prev_streams };
        })
        .filter((r) => Boolean(r.isrc))
        .slice(0, 200);

      const isrcs = sample.map((s) => s.isrc);
      if (isrcs.length === 0) {
        excludedTracksZeroedByKey.set(key, null);
        continue;
      }

      const { data: trackRows, error } = await svc
        .from("tracks")
        .select("isrc,name,spotify_artist_names,spotify_artist_ids,spotify_album_image_url")
        .in("isrc", isrcs);

      if (error) {
        console.error("Failed to fetch excluded_track_streams_zeroed tracks:", error);
        excludedTracksZeroedByKey.set(key, null);
        continue;
      }

      const metaByIsrc = new Map<
        string,
        {
          isrc: string;
          name: string | null;
          artist_names: string[] | null;
          artist_ids: string[] | null;
          album_image_url: string | null;
        }
      >(
        (trackRows ?? []).map((t: any) => [
          String(t?.isrc ?? "").trim().toUpperCase(),
          {
            isrc: String(t?.isrc ?? "").trim().toUpperCase(),
            name: (t?.name ?? null) as string | null,
            artist_names: (t?.spotify_artist_names ?? null) as string[] | null,
            artist_ids: (t?.spotify_artist_ids ?? null) as string[] | null,
            album_image_url: (t?.spotify_album_image_url ?? null) as string | null,
          },
        ]),
      );

      const tracks = sample.map((s) => {
        const meta = metaByIsrc.get(s.isrc) ?? null;
        return {
          isrc: s.isrc,
          name: meta?.name ?? null,
          artist_names: meta?.artist_names ?? null,
          artist_ids: meta?.artist_ids ?? null,
          album_image_url: meta?.album_image_url ?? null,
          prev_streams: s.prev_streams ?? null,
        };
      });

      excludedTracksZeroedByKey.set(key, tracks);
    }
  }

  // Fetch tracks for warning `total_streams_decreased`
  // This warning contains { isrc, prev_streams, today_streams, delta } under `decreased_tracks` in details_json.
  const totalStreamsDecreasedByKey = new Map<
    string,
    Array<{
      isrc: string;
      name: string | null;
      artist_names?: string[] | null;
      artist_ids?: string[] | null;
      album_image_url?: string | null;
      prev_streams?: number | null;
      today_streams?: number | null;
      delta?: number | null;
    }> | null
  >();

  const totalStreamsDecreasedWarnings = warnings.filter(
    (w) => w.code === "total_streams_decreased" && selectedRunDate
  );

  if (totalStreamsDecreasedWarnings.length > 0) {
    for (const w of totalStreamsDecreasedWarnings) {
      const key = String(w.playlist_key ?? "global");
      const raw = (w as any)?.details_json?.decreased_tracks;
      const rows = Array.isArray(raw) ? (raw as unknown[]) : [];

      const sample = rows
        .map((r) => {
          const row = (r ?? {}) as Record<string, unknown>;
          const isrc = String(row.isrc ?? "").trim().toUpperCase().replace(/\s+/g, "");
          const prev = Number(row.prev_streams ?? NaN);
          const today = Number(row.today_streams ?? NaN);
          const delta = Number(row.delta ?? NaN);
          return {
            isrc,
            prev_streams: Number.isFinite(prev) ? prev : null,
            today_streams: Number.isFinite(today) ? today : null,
            delta: Number.isFinite(delta) ? delta : null,
          };
        })
        .filter((r) => Boolean(r.isrc))
        .slice(0, 200);

      const isrcs = sample.map((s) => s.isrc);
      if (isrcs.length === 0) {
        totalStreamsDecreasedByKey.set(key, null);
        continue;
      }

      const { data: trackRows, error } = await svc
        .from("tracks")
        .select("isrc,name,spotify_artist_names,spotify_artist_ids,spotify_album_image_url")
        .in("isrc", isrcs);

      if (error) {
        console.error("Failed to fetch total_streams_decreased tracks:", error);
        totalStreamsDecreasedByKey.set(key, null);
        continue;
      }

      const metaByIsrc = new Map<
        string,
        {
          isrc: string;
          name: string | null;
          artist_names: string[] | null;
          artist_ids: string[] | null;
          album_image_url: string | null;
        }
      >(
        (trackRows ?? []).map((t: any) => [
          String(t?.isrc ?? "").trim().toUpperCase(),
          {
            isrc: String(t?.isrc ?? "").trim().toUpperCase(),
            name: (t?.name ?? null) as string | null,
            artist_names: (t?.spotify_artist_names ?? null) as string[] | null,
            artist_ids: (t?.spotify_artist_ids ?? null) as string[] | null,
            album_image_url: (t?.spotify_album_image_url ?? null) as string | null,
          },
        ]),
      );

      const tracks = sample.map((s) => {
        const meta = metaByIsrc.get(s.isrc) ?? null;
        return {
          isrc: s.isrc,
          name: meta?.name ?? null,
          artist_names: meta?.artist_names ?? null,
          artist_ids: meta?.artist_ids ?? null,
          album_image_url: meta?.album_image_url ?? null,
          prev_streams: s.prev_streams ?? null,
          today_streams: s.today_streams ?? null,
          delta: s.delta ?? null,
        };
      });

      totalStreamsDecreasedByKey.set(key, tracks);
    }
  }

  // Fetch entity-distro drift warnings
  const entityDistroDriftMap = new Map<
    string,
    {
      extra: Array<{
        isrc: string;
        name: string | null;
        artist_names?: string[] | null;
        artist_ids?: string[] | null;
        album_image_url?: string | null;
        source_playlist_key?: string | null;
      }>;
      missing: Array<{
        isrc: string;
        name: string | null;
        artist_names?: string[] | null;
        artist_ids?: string[] | null;
        album_image_url?: string | null;
      }>;
    }
  >();
  let entityDistroDriftLoaded = false;

  const entityDistroDriftWarnings = warnings.filter(
    (w) => w.code === "entity_distro_drift" && w.playlist_key && selectedRunDate
  );

  if (entityDistroDriftWarnings.length > 0 && selectedRunDate) {
    // Fetch drift details from the RPC
    const { data: driftRows, error: driftErr } = await svc.rpc("health_entity_distro_drift", {
      run_date: selectedRunDate,
    });

    if (!driftErr) {
      entityDistroDriftLoaded = true;
      const rows = (driftRows ?? []) as Array<{
        entity_playlist_key: string;
        drift_type: string;
        isrc: string;
        source_playlist_key: string | null;
        name: string | null;
        artist_names: string[] | null;
        artist_ids: string[] | null;
        album_image_url: string | null;
      }>;

      // Group by entity_playlist_key
      for (const row of rows) {
        const key = normalizeKey(row.entity_playlist_key);
        if (!key) continue;
        if (!entityDistroDriftMap.has(key)) {
          entityDistroDriftMap.set(key, { extra: [], missing: [] });
        }
        const entry = entityDistroDriftMap.get(key)!;
        const track = {
          isrc: String(row.isrc ?? "").trim().toUpperCase(),
          name: row.name ?? null,
          artist_names: row.artist_names ?? null,
          artist_ids: row.artist_ids ?? null,
          album_image_url: row.album_image_url ?? null,
          source_playlist_key: (row.source_playlist_key ?? null)
            ? String(row.source_playlist_key).trim()
            : null,
        };
        if (row.drift_type === "extra_in_distro") {
          entry.extra.push(track);
        } else if (row.drift_type === "missing_from_distro") {
          entry.missing.push(track);
        }
      }
    }
  }

  // Fetch distro overlap tracks (ISRCs active in 2+ Distro playlists)
  let distroOverlapTracks: Array<{
    isrc: string;
    name: string | null;
    artist_names: string[] | null;
    artist_ids: string[] | null;
    album_image_url: string | null;
    distro_playlist_keys: string[];
  }> | null = null;

  const distroOverlapWarnings = warnings.filter(
    (w) => w.code === "distro_overlap"
  );

  if (distroOverlapWarnings.length > 0 && selectedRunDate) {
    try {
      const { data: rows, error } = await svc.rpc("health_distro_overlap_tracks", {
        run_date: selectedRunDate,
      });

      if (error) {
        console.error("health_distro_overlap_tracks RPC failed:", error);
      } else {
        distroOverlapTracks = (rows ?? []).map((t: unknown) => {
          const row = (t ?? {}) as Record<string, unknown>;
          return {
            isrc: String(row.isrc ?? "").trim().toUpperCase(),
            name: (row.name ?? null) as string | null,
            artist_names: (row.artist_names ?? null) as string[] | null,
            artist_ids: (row.artist_ids ?? null) as string[] | null,
            album_image_url: (row.album_image_url ?? null) as string | null,
            distro_playlist_keys: Array.isArray(row.distro_playlist_keys)
              ? (row.distro_playlist_keys as string[])
              : [],
          };
        });
      }
    } catch {
      // Don't block page render if RPC is not yet deployed
    }
  }

  // Fetch ALL tracks missing from catalog across all playlists for the selected date
  let allMissingTracks: Array<{
    isrc: string;
    name: string | null;
    artist_names: string[] | null;
    artist_ids: string[] | null;
    album_image_url: string | null;
    playlists: string[];
  }> = [];

  if (selectedRunDate) {
    const { data: rows, error } = await svc.rpc("health_missing_catalog_tracks", {
      run_date: selectedRunDate,
    });

    if (error) {
      console.error("health_missing_catalog_tracks RPC failed:", error);
    } else {
      const missingTracksRaw: typeof allMissingTracks = (rows ?? []).map((t: unknown) => {
        const row = (t ?? {}) as Record<string, unknown>;
        const isrc = String(row.isrc ?? "").trim().toUpperCase();
        return {
          isrc,
          name: (row.name ?? null) as string | null,
          artist_names: (row.artist_names ?? null) as string[] | null,
          artist_ids: (row.artist_ids ?? null) as string[] | null,
          album_image_url: (row.album_image_url ?? null) as string | null,
          playlists: Array.isArray(row.playlist_keys) ? (row.playlist_keys as string[]) : [],
        };
      });

      allMissingTracks = exclusionsEnabled
        ? missingTracksRaw.filter((t) => !t.playlists.some((pk) => isExcluded(pk, t.isrc)))
        : missingTracksRaw;
    }
  }

  // Warnings are already filtered by getActiveWarningSummary(); just sort for display.
  const displayedWarnings = [...warnings].sort((a, b) => {
    const r = severityRank(a.severity) - severityRank(b.severity);
    if (r !== 0) return r;
    const ap = normalizeKey(a.playlist_key);
    const bp = normalizeKey(b.playlist_key);
    if (ap !== bp) return ap.localeCompare(bp);
    const ac = normalizeKey(a.code);
    const bc = normalizeKey(b.code);
    if (ac !== bc) return ac.localeCompare(bc);
    return (a.message ?? "").localeCompare(b.message ?? "");
  });

  // Override stale warning messages with actual current counts.
  // The stored messages reflect ingestion-time counts; tracks may have been enriched
  // or excluded since then. Patch the message text for display.
  const displayedWarningsPatched = displayedWarnings.map((w) => {
    if (w.code === "tracks_missing_enrichment" && w.playlist_key) {
      const tracks = missingEnrichmentTracksMap.get(w.playlist_key);
      if (Array.isArray(tracks)) {
        return { ...w, message: `${tracks.length} track(s) in playlist are missing Spotify enrichment data` };
      }
    }
    if (w.code === "non_catalog_tracks_present" && w.playlist_key) {
      const tracks = nonCatalogTracksMap.get(w.playlist_key);
      if (tracks) {
        return { ...w, message: `${tracks.length} track(s) in playlist have no catalog stream snapshot today` };
      }
    }
    if (w.code === "entity_distro_drift" && w.playlist_key) {
      const pk = normalizeKey(w.playlist_key);
      const drift = entityDistroDriftMap.get(pk) ?? { extra: [], missing: [] };
      if (entityDistroDriftLoaded) {
        const plName = playlistMetaByKey.get(pk)?.name ?? pk;
        const extra = drift.extra.length;
        const missing = drift.missing.length;
        return {
          ...w,
          message: `Entity/Distro mismatch for ${plName}: ${extra} extra in Distro, ${missing} missing from Distro`,
        };
      }
    }
    if (w.code === "track_count_swing" && w.playlist_key) {
      const swing = trackCountSwingTracksMap.get(w.playlist_key);
      if (swing) {
        return {
          ...w,
          message: `Track count swing: ${swing.added.length} added, ${swing.removed.length} removed`,
        };
      }
    }
    if (w.code === "catalog_missing_stream_snapshots") {
      const key = String(w.playlist_key ?? "global");
      const tracks = catalogMissingStreamSnapshotTracksByKey.get(key);
      if (Array.isArray(tracks)) {
        return { ...w, message: `${tracks.length} catalog track(s) are missing stream snapshots today` };
      }
    }
    if (w.code === "catalog_streams_missing_prev_nonzero") {
      const key = String(w.playlist_key ?? "global");
      const tracks = catalogStreamsMissingPrevNonzeroTracksByKey.get(key);
      if (Array.isArray(tracks)) {
        return { ...w, message: `${tracks.length} catalog track(s) have zero streams today but had streams previously` };
      }
    }
    if (w.code === "distro_overlap" && Array.isArray(distroOverlapTracks)) {
      return { ...w, message: `${distroOverlapTracks.length} track(s) appear in multiple Distro playlists` };
    }
    if (w.code === "total_streams_decreased") {
      const key = String(w.playlist_key ?? "global");
      const tracks = totalStreamsDecreasedByKey.get(key);
      const delta = w.details_json?.delta;
      const prevTotal = w.details_json?.prev_total_streams_cumulative;
      const todayTotal = w.details_json?.today_total_streams_cumulative;
      const trackCount = Array.isArray(tracks) ? tracks.length : (w.details_json?.decreased_tracks_total ?? 0);
      const deltaStr = typeof delta === "number" ? delta.toLocaleString() : "?";
      return {
        ...w,
        message: `Total streams decreased ${deltaStr} (${typeof prevTotal === "number" ? prevTotal.toLocaleString() : "?"} → ${typeof todayTotal === "number" ? todayTotal.toLocaleString() : "?"}) — ${trackCount} track(s) decreased`,
      };
    }
    return w;
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="System Health"
        subtitle={
          latestRunDate
            ? `Recent ingestion runs and anomaly warnings. Last ingested: ${dataDateFromRunDate(latestRunDate)}`
            : "Recent ingestion runs and anomaly warnings."
        }
        actions={<RefreshButton />}
      />

      {(runsErr || exportsErr) && (
        <Alert
          variant="error"
          title="Query error"
        >
          {runsErr?.message ?? exportsErr?.message ?? "unknown error"}
        </Alert>
      )}

      <div className="space-y-2">
        <SectionHeader
          title={
            <>
              Warnings{" "}
              {selectedDataDate ? (
                <span className="text-xs font-normal opacity-60">
                  (Data: {selectedDataDate}, Run: {selectedRunDate})
                </span>
              ) : null}
            </>
          }
          actions={undefined}
        />
        <GlassTable
          tableLayout="fixed"
          headers={[
            { label: "Severity", className: "w-[74px]" },
            { label: "Code", className: "hidden sm:table-cell sm:w-[160px]" },
            { label: "Playlist", className: "hidden sm:table-cell sm:w-[190px]" },
            { label: "Message" },
          ]}
        >
          {displayedWarningsPatched.map((w, i) => (
            <WarningRow
              key={`${w.code}-${w.playlist_key ?? "global"}-${i}`}
              warning={w}
              playlistMeta={w.playlist_key ? playlistMetaByKey.get(w.playlist_key) ?? null : null}
              allPlaylistMeta={allPlaylistMeta}
              nonCatalogTracks={
                w.code === "non_catalog_tracks_present" && w.playlist_key
                  ? nonCatalogTracksMap.get(w.playlist_key)
                  : undefined
              }
              catalogMissingStreamSnapshotTracks={
                w.code === "catalog_missing_stream_snapshots"
                  ? catalogMissingStreamSnapshotTracksByKey.get(String(w.playlist_key ?? "global"))
                  : undefined
              }
              catalogStreamsMissingPrevNonzeroTracks={
                w.code === "catalog_streams_missing_prev_nonzero"
                  ? catalogStreamsMissingPrevNonzeroTracksByKey.get(String(w.playlist_key ?? "global"))
                  : undefined
              }
              trackCountSwingTracks={
                w.code === "track_count_swing" && w.playlist_key
                  ? trackCountSwingTracksMap.get(w.playlist_key)
                  : undefined
              }
              missingEnrichmentTracks={
                w.code === "tracks_missing_enrichment" && w.playlist_key
                  ? missingEnrichmentTracksMap.get(w.playlist_key)
                  : undefined
              }
              enrichmentWarning={w.code === "tracks_missing_enrichment" ? w.details_json : undefined}
              entityDistroDrift={
                w.code === "entity_distro_drift" && w.playlist_key
                  ? entityDistroDriftMap.get(normalizeKey(w.playlist_key))
                  : undefined
              }
              individualTracksStaleTracks={
                w.code === "individual_tracks_stale"
                  ? individualTracksStaleByKey.get(String(w.playlist_key ?? "global"))
                  : undefined
              }
              excludedTracksZeroedTracks={
                w.code === "excluded_track_streams_zeroed"
                  ? excludedTracksZeroedByKey.get(String(w.playlist_key ?? "global"))
                  : undefined
              }
              distroOverlapTracks={
                w.code === "distro_overlap"
                  ? distroOverlapTracks
                  : undefined
              }
              totalStreamsDecreasedTracks={
                w.code === "total_streams_decreased"
                  ? totalStreamsDecreasedByKey.get(String(w.playlist_key ?? "global"))
                  : undefined
              }
              dataDate={selectedDataDate}
            />
          ))}
          {!displayedWarningsPatched.length && (
            <EmptyState colSpan={4} message="No warnings found for the selected filters." />
          )}
        </GlassTable>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <BatchInterpolateTool />
        <WarningHistoryChart />
      </div>

      {selectedRunDate && allMissingTracks.length > 0 && (
        <div className="space-y-2">
          <SectionHeader
            title={
              <>
                All Missing Catalog Tracks{" "}
                <span className="text-xs font-normal opacity-60">({selectedDataDate})</span>
              </>
            }
            subtitle="Tracks in playlists that don't have stream data in the catalog snapshot for this day"
            actions={
              <>
                <span className="text-xs opacity-60">{allMissingTracks.length} tracks</span>
                <ExportMissingTracksButton tracks={allMissingTracks} date={selectedDataDate ?? "—"} />
              </>
            }
          />
          <GlassTable headers={["Track", "Artists", "Playlists"]}>
            {allMissingTracks.map((track) => (
              <TableRow key={track.isrc}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    {track.album_image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={track.album_image_url}
                        alt="Album cover"
                        className="h-10 w-10 rounded object-cover sb-ring flex-shrink-0"
                      />
                    ) : (
                      <div className="h-10 w-10 rounded sb-ring bg-white/60 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <Link
                        href={`/tracks/${track.isrc}`}
                        className="font-medium hover:underline"
                        style={{ color: "var(--sb-text)" }}
                      >
                        {track.name || track.isrc}
                      </Link>
                      <div className="mt-0.5">
                        <Link
                          href={`/tracks/${track.isrc}`}
                          className="font-mono text-[10px] text-lime-600 dark:text-lime-400 underline hover:opacity-80"
                        >
                          {track.isrc}
                        </Link>
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  {track.artist_names && track.artist_names.length > 0 ? (
                    <ArtistLinks artistNames={track.artist_names} artistIds={track.artist_ids ?? undefined} />
                  ) : (
                    <span className="opacity-30">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {track.playlists.map((pl) => (
                      <Link
                        key={pl}
                        href={`/playlists?playlist_key=${encodeURIComponent(String(pl))}`}
                        className="font-mono text-[10px] underline hover:text-lime-600 dark:hover:text-lime-400"
                      >
                        {pl}
                      </Link>
                    ))}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </GlassTable>
        </div>
      )}

      <CollapsibleSection
        title="Ingestion Runs (30d)"
        storageKey="sb:health:details:ingestion_runs"
      >
        <GlassTable headers={["Run Date", "Status", "Logs"]} maxBodyHeightClassName="max-h-[260px]">
          {(runs ?? []).map((r) => (
            <TableRow key={r.run_date}>
              <TableCell mono>{formatDateISO(dataDateFromRunDate(r.run_date))}</TableCell>
              <TableCell>
                <span
                  className={[
                    "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
                    r.status === "success"
                      ? "bg-lime-500/20 text-lime-700 dark:bg-lime-500/30 dark:text-lime-300"
                      : "bg-red-500/20 text-red-700 dark:bg-red-500/30 dark:text-red-300",
                  ].join(" ")}
                >
                  {r.status}
                </span>
              </TableCell>
              <TableCell>
                {r.logs_url ? (
                  <a
                    className="underline"
                    href={r.logs_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    open
                  </a>
                ) : (
                  "—"
                )}
              </TableCell>
            </TableRow>
          ))}
          {!runs?.length && <EmptyState colSpan={3} message="No ingestion runs yet." />}
        </GlassTable>
      </CollapsibleSection>

      <CollapsibleSection
        title={
          <>
            Raw Exports{" "}
            {selectedDataDate ? <span className="text-[10px] font-normal normal-case tracking-normal opacity-40">({selectedDataDate})</span> : null}
          </>
        }
        storageKey="sb:health:details:raw_exports"
      >
        <GlassTable
          headers={[
            { label: "Playlist" },
            { label: "Rows", align: "right" },
            { label: "Exported", align: "right" },
            { label: "Download" },
          ]}
        >
          {(exportsForLatest ?? []).map((r) => (
            <TableRow key={r.playlist_key}>
              <TableCell mono className="text-xs">
                {(() => {
                  const key = String(r.playlist_key ?? "").trim();
                  const meta = playlistMetaByKey.get(key) ?? null;
                  const name = meta?.name ?? key;
                  const imgUrl = meta?.imageUrl ?? null;

                  return (
                    <div className="flex items-center gap-2 min-w-0">
                      {imgUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={imgUrl}
                          alt=""
                          className="h-8 w-8 rounded object-cover sb-ring flex-shrink-0"
                        />
                      ) : (
                        <div className="h-8 w-8 rounded sb-ring bg-white/60 flex-shrink-0" />
                      )}
                      <div className="min-w-0">
                        <Link
                          href={`/playlists?playlist_key=${encodeURIComponent(String(key))}`}
                          className="font-medium hover:underline block truncate"
                          style={{ color: "var(--sb-text)" }}
                          title={name}
                        >
                          {name}
                        </Link>
                        <div className="text-[10px] opacity-60 truncate" title={key}>
                          {key}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </TableCell>
              <TableCell numeric>{r.rows_count ?? null}</TableCell>
              <TableCell numeric mono className="text-xs">
                {r.exported_at ? new Date(r.exported_at).toLocaleString() : null}
              </TableCell>
              <TableCell>
                {r.storage_bucket && r.object_key ? (
                  <a
                    className="underline"
                    href={`/exports?bucket=${encodeURIComponent(r.storage_bucket)}&key=${encodeURIComponent(r.object_key)}`}
                  >
                    csv
                  </a>
                ) : (
                  null
                )}
              </TableCell>
            </TableRow>
          ))}
          {!exportsForLatest?.length && <EmptyState colSpan={4} message="No raw exports found for this run." />}
        </GlassTable>
      </CollapsibleSection>
    </div>
  );
}

