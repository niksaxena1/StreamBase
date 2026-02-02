import Link from "next/link";
import { redirect } from "next/navigation";

import { formatDateISO } from "@/lib/format";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { GlassTable, TableRow, TableCell, EmptyState } from "@/components/ui/GlassTable";
import { WarningRow } from "@/components/health/WarningRow";
import { ArtistLinks } from "@/components/ui/ArtistLinks";
import { ExportMissingTracksButton } from "@/components/health/ExportMissingTracksButton";
import { PageHeader } from "@/components/shell/PageHeader";
import { addDaysISO, dataDateFromRunDate, SOT_DATA_LAG_DAYS } from "@/lib/sotDates";
import { Alert } from "@/components/ui/Alert";
import { SectionHeader } from "@/components/ui/SectionHeader";

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

  // Build warnings query with filters
  let warningsQuery = svc
    .from("ingestion_warnings")
    .select("severity,code,playlist_key,message,run_date,details_json")
    .order("playlist_key", { ascending: true });

  if (selectedRunDate) {
    warningsQuery = warningsQuery.eq("run_date", selectedRunDate);
  }

  const { data: warnings, error: warnErr } = await warningsQuery.limit(200);

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
  const playlistMetaByKey = new Map<string, { name: string; imageUrl: string | null }>();
  const playlistKeysNeedingMeta = Array.from(
    new Set(
      [
        ...(warnings ?? []).map((w) => (w?.playlist_key ?? "").trim()),
        ...(exportsForLatest ?? []).map((e) => String((e ?? {}).playlist_key ?? "").trim()),
      ].filter(Boolean),
    ),
  );
  if (playlistKeysNeedingMeta.length > 0) {
    const { data: plRows } = await svc
      .from("playlists")
      .select("playlist_key,display_name,spotify_playlist_image_url")
      .in("playlist_key", playlistKeysNeedingMeta)
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

  // Fetch non-catalog tracks for warnings of type "non_catalog_tracks_present"
  const nonCatalogWarnings = (warnings ?? []).filter(
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
    for (const warning of nonCatalogWarnings) {
      if (!warning.playlist_key) continue;
      const { data: rows, error } = await svc.rpc("health_playlist_missing_catalog_tracks", {
        playlist_key: warning.playlist_key,
        run_date: selectedRunDate,
      });

      if (error) {
        console.error("health_playlist_missing_catalog_tracks RPC failed:", error);
        continue;
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
    }
  }

  // Fetch added/removed tracks for track_count_swing warnings
  const trackCountSwingWarnings = (warnings ?? []).filter(
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
    for (const warning of trackCountSwingWarnings) {
      if (!warning.playlist_key) continue;
      const { data: rows, error } = await svc.rpc("health_track_count_swing_tracks", {
        playlist_key: warning.playlist_key,
        run_date: selectedRunDate,
      });

      if (error) {
        console.error("health_track_count_swing_tracks RPC failed:", error);
        continue;
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
    }
  }

  // Fetch missing enrichment tracks for warnings
  const missingEnrichmentWarnings = (warnings ?? []).filter(
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
    for (const warning of missingEnrichmentWarnings) {
      if (!warning.playlist_key) continue;
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
          // All tracks were excluded for this warning.
          missingEnrichmentTracksMap.set(warning.playlist_key ?? "", []);
          continue;
        }

        const { data: rows, error } = await svc
          .from("tracks")
          .select("isrc,name,spotify_artist_names,spotify_artist_ids,spotify_album_image_url")
          .in("isrc", filteredIsrcs);

        if (error) {
          console.error("Failed to fetch missing enrichment tracks:", error);
          // Set null to indicate we couldn't fetch the details
          missingEnrichmentTracksMap.set(warning.playlist_key, null);
          continue;
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
        const tracks = enrichmentExclusionsEnabled
          ? tracksRaw.filter((t) => !isExcludedEnrichment(warning.playlist_key!, t.isrc))
          : tracksRaw;
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
          continue;
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
        const tracks = enrichmentExclusionsEnabled
          ? tracksRaw.filter((t) => !isExcludedEnrichment(warning.playlist_key!, t.isrc))
          : tracksRaw;
        missingEnrichmentTracksMap.set(warning.playlist_key ?? "", tracks);
      }
    }
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

  const catalogMissingSnapshotWarnings = (warnings ?? []).filter(
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

  const catalogStreamsMissingPrevNonzeroWarnings = (warnings ?? []).filter(
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

  const displayedWarnings = (warnings ?? [])
    .filter((w) => {
      // If exclusions are configured and *all* non-catalog tracks for a warning are excluded,
      // hide that warning row in the UI (the next ingestion run will also stop generating it).
      if (w.code === "non_catalog_tracks_present" && w.playlist_key) {
        if (!exclusionsEnabled) return true;
        const tracks = nonCatalogTracksMap.get(w.playlist_key) ?? [];
        return tracks.length > 0;
      }

      if (w.code === "tracks_missing_enrichment" && w.playlist_key) {
        if (!enrichmentExclusionsEnabled) return true;
        const tracks = missingEnrichmentTracksMap.get(w.playlist_key);
        // If we successfully computed the list and it's empty, suppress the row.
        if (Array.isArray(tracks)) return tracks.length > 0;
        return true;
      }

      return true;
    })
    .sort((a, b) => {
      const r = severityRank(a.severity) - severityRank(b.severity);
      if (r !== 0) return r;
      const ap = (a.playlist_key ?? "").trim();
      const bp = (b.playlist_key ?? "").trim();
      if (ap !== bp) return ap.localeCompare(bp);
      const ac = (a.code ?? "").trim();
      const bc = (b.code ?? "").trim();
      if (ac !== bc) return ac.localeCompare(bc);
      return (a.message ?? "").localeCompare(b.message ?? "");
    });

  return (
    <div className="space-y-4">
      <PageHeader
        title="System Health"
        subtitle="Recent ingestion runs and anomaly warnings."
      />

      {(runsErr || warnErr || exportsErr) && (
        <Alert
          variant="error"
          title="Query error"
        >
          {runsErr?.message ?? exportsErr?.message ?? warnErr?.message ?? "unknown error"}
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
          {displayedWarnings.map((w, i) => (
            <WarningRow
              key={`${w.code}-${w.playlist_key ?? "global"}-${i}`}
              warning={w}
              playlistMeta={w.playlist_key ? playlistMetaByKey.get(w.playlist_key) ?? null : null}
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
            />
          ))}
          {!displayedWarnings.length && (
            <EmptyState colSpan={4} message="No warnings found for the selected filters." />
          )}
        </GlassTable>
      </div>

      {selectedRunDate && (
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
              allMissingTracks.length > 0 ? (
                <>
                  <span className="text-xs opacity-60">{allMissingTracks.length} tracks</span>
                  <ExportMissingTracksButton tracks={allMissingTracks} date={selectedDataDate ?? "—"} />
                </>
              ) : null
            }
          />
          <GlassTable headers={["Track", "Artists", "Playlists"]}>
            {allMissingTracks.length > 0 ? (
              allMissingTracks.map((track) => (
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
                          href={`/playlists/${pl}`}
                          className="font-mono text-[10px] underline hover:text-lime-600 dark:hover:text-lime-400"
                        >
                          {pl}
                        </Link>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : <EmptyState colSpan={3} message={`No missing catalog tracks found for ${selectedDataDate}.`} />}
          </GlassTable>
        </div>
      )}

      <div className="space-y-2">
        <SectionHeader title="Ingestion Runs (30d)" />
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
      </div>

      <div className="space-y-2">
        <SectionHeader
          title={
            <>
              Raw Exports{" "}
              {selectedDataDate ? <span className="text-xs font-normal opacity-60">({selectedDataDate})</span> : null}
            </>
          }
          actions={undefined}
        />
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
                          href={`/playlists/${key}`}
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
      </div>
    </div>
  );
}

