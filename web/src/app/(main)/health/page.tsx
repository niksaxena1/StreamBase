import Link from "next/link";
import { redirect } from "next/navigation";

import { formatDateISO } from "@/lib/format";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { GlassTable, TableRow, TableCell } from "@/components/ui/GlassTable";
import { WarningRow } from "@/components/health/WarningRow";
import { ArtistLinks } from "@/components/ui/ArtistLinks";
import { ExportMissingTracksButton } from "@/components/health/ExportMissingTracksButton";
import { addDaysISO, dataDateFromRunDate, SOT_DATA_LAG_DAYS } from "@/lib/sotDates";

export const revalidate = 60; // Revalidate every 60 seconds for fresher health data

function FilterToggle({
  active,
  href,
  children,
}: {
  active: boolean;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={[
        "rounded-full px-2.5 py-1.5 text-[11px] font-medium transition",
        active
          ? "bg-black text-white shadow-sm dark:bg-white dark:text-black"
          : "bg-white/70 text-black/70 hover:bg-white dark:bg-white/10 dark:text-white/70 dark:hover:bg-white/20",
      ].join(" ")}
    >
      {children}
    </Link>
  );
}

export default async function HealthPage({
  searchParams,
}: {
  // See note in other pages: keep this as `any` to satisfy Next's generated PageProps typing
  // while avoiding `await searchParams` (which breaks static generation in Next 16).
  searchParams?: any;
}) {
  const sp = (searchParams ?? {}) as { severity?: string; playlist?: string; date?: string };
  const severityFilter = sp.severity ?? "all";
  const playlistFilter = sp.playlist ?? "all";
  const dateFilter = sp.date;

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
        const isrc = String((r as any).isrc ?? "").trim().toUpperCase();
        const playlist_key = String((r as any).playlist_key ?? "").trim();
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
        const isrc = String((r as any).isrc ?? "").trim().toUpperCase();
        const playlist_key = String((r as any).playlist_key ?? "").trim();
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
    .order("severity", { ascending: false })
    .order("playlist_key", { ascending: true });

  if (selectedRunDate) {
    warningsQuery = warningsQuery.eq("run_date", selectedRunDate);
  }

  if (severityFilter !== "all") {
    warningsQuery = warningsQuery.eq("severity", severityFilter);
  }

  if (playlistFilter !== "all") {
    warningsQuery = warningsQuery.eq("playlist_key", playlistFilter);
  }

  const { data: warnings, error: warnErr } = await warningsQuery.limit(200);

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

      nonCatalogTracksMap.set(
        warning.playlist_key ?? "",
        (rows ?? []).map((t: any) => ({
          isrc: t.isrc,
          name: t.name,
          artist_names: t.artist_names,
          artist_ids: t.artist_ids,
          album_image_url: t.album_image_url,
        })),
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

      const added = (rows ?? []).filter((r: any) => r.change_type === "added").map((r: any) => ({
        isrc: r.isrc,
        name: r.name ?? null,
        artist_names: r.artist_names ?? null,
        artist_ids: r.artist_ids ?? null,
        album_image_url: r.album_image_url ?? null,
      }));
      const removed = (rows ?? []).filter((r: any) => r.change_type === "removed").map((r: any) => ({
        isrc: r.isrc,
        name: r.name ?? null,
        artist_names: r.artist_names ?? null,
        artist_ids: r.artist_ids ?? null,
        album_image_url: r.album_image_url ?? null,
      }));

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
          ? (isrcList as any[])
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

        const tracksRaw = (rows ?? []).map((t: any) => ({
          isrc: t.isrc,
          name: t.name,
          artist_names: t.spotify_artist_names,
          artist_ids: t.spotify_artist_ids,
          album_image_url: t.spotify_album_image_url,
        }));
        const tracks = enrichmentExclusionsEnabled
          ? tracksRaw.filter((t) => !isExcludedEnrichment(warning.playlist_key!, String(t.isrc ?? "").trim().toUpperCase()))
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
        }> = (rows ?? []).map((t: any) => ({
          isrc: String(t?.isrc ?? "").trim().toUpperCase(),
          name: (t?.name ?? null) as string | null,
          artist_names: (t?.artist_names ?? null) as string[] | null,
          artist_ids: (t?.artist_ids ?? null) as string[] | null,
          album_image_url: (t?.album_image_url ?? null) as string | null,
        }));
        const tracks = enrichmentExclusionsEnabled
          ? tracksRaw.filter((t) => !isExcludedEnrichment(warning.playlist_key!, String(t.isrc ?? "").trim().toUpperCase()))
          : tracksRaw;
        missingEnrichmentTracksMap.set(warning.playlist_key ?? "", tracks);
      }
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
      allMissingTracks = (rows ?? []).map((t: any) => ({
        isrc: t.isrc,
        name: t.name,
        artist_names: t.artist_names,
        artist_ids: t.artist_ids,
        album_image_url: t.album_image_url,
        playlists: Array.isArray(t.playlist_keys) ? t.playlist_keys : [],
      }));
    }
  }

  // Build filter URLs
  function hrefWith(patch: { severity?: string; playlist?: string; date?: string }) {
    const params = new URLSearchParams();
    const severity = patch.severity ?? severityFilter;
    const playlist = patch.playlist ?? playlistFilter;
    const date = patch.date ?? dateFilter;
    if (severity !== "all") params.set("severity", severity);
    if (playlist !== "all") params.set("playlist", playlist);
    if (date) params.set("date", date);
    const query = params.toString();
    return query ? `/health?${query}` : "/health";
  }

  // Get date range for picker
  const firstRunDate = runs?.[runs.length - 1]?.run_date ?? selectedRunDate ?? new Date().toISOString().split("T")[0];
  const firstDate = dataDateFromRunDate(firstRunDate);
  const today = dataDateFromRunDate(new Date().toISOString().split("T")[0]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
          System Health
        </h1>
        <p className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
          Recent ingestion runs and anomaly warnings.
        </p>
      </div>

      {(runsErr || warnErr || exportsErr) && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-950 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-200">
          Query error:{" "}
          {runsErr?.message ??
            exportsErr?.message ??
            warnErr?.message ??
            "unknown error"}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="sb-ring flex items-center gap-0.5 rounded-full bg-white/70 p-0.5 text-xs dark:bg-black/50">
          <FilterToggle active={severityFilter === "all"} href={hrefWith({ severity: "all" })}>
            All
          </FilterToggle>
          <FilterToggle active={severityFilter === "critical"} href={hrefWith({ severity: "critical" })}>
            Critical
          </FilterToggle>
          <FilterToggle active={severityFilter === "warn"} href={hrefWith({ severity: "warn" })}>
            Warn
          </FilterToggle>
          <FilterToggle active={severityFilter === "info"} href={hrefWith({ severity: "info" })}>
            Info
          </FilterToggle>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-sm font-semibold">
            Warnings{" "}
            {selectedDataDate ? (
              <span className="text-xs font-normal opacity-60">
                (Data: {selectedDataDate}, Run: {selectedRunDate})
              </span>
            ) : null}
          </h2>
          <Link className="text-xs underline opacity-60" href="/playlists">
            View playlists
          </Link>
        </div>
        <GlassTable headers={["Severity", "Code", "Playlist", "Message"]}>
          {(warnings ?? [])
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
            .map((w, i) => (
            <WarningRow
              key={`${w.code}-${w.playlist_key ?? "global"}-${i}`}
              warning={w}
              nonCatalogTracks={w.code === "non_catalog_tracks_present" && w.playlist_key
                ? nonCatalogTracksMap.get(w.playlist_key)
                : undefined}
              trackCountSwingTracks={w.code === "track_count_swing" && w.playlist_key
                ? trackCountSwingTracksMap.get(w.playlist_key)
                : undefined}
              missingEnrichmentTracks={w.code === "tracks_missing_enrichment" && w.playlist_key
                ? missingEnrichmentTracksMap.get(w.playlist_key)
                : undefined}
              enrichmentWarning={w.code === "tracks_missing_enrichment"
                ? w.details_json
                : undefined}
            />
          ))}
          {!((warnings ?? [])
            .filter((w) => {
              if (w.code === "non_catalog_tracks_present" && w.playlist_key) {
                if (!exclusionsEnabled) return true;
                const tracks = nonCatalogTracksMap.get(w.playlist_key) ?? [];
                return tracks.length > 0;
              }

              if (w.code === "tracks_missing_enrichment" && w.playlist_key) {
                if (!enrichmentExclusionsEnabled) return true;
                const tracks = missingEnrichmentTracksMap.get(w.playlist_key);
                if (Array.isArray(tracks)) return tracks.length > 0;
                return true;
              }

              return true;
            }).length) && (
            <TableRow>
              <TableCell className="text-center opacity-50 py-8" colSpan={4}>
                No warnings found for the selected filters.
              </TableCell>
            </TableRow>
          )}
        </GlassTable>
      </div>

      {selectedRunDate && (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <div>
              <h2 className="text-sm font-semibold">
                All Missing Catalog Tracks{" "}
                <span className="text-xs font-normal opacity-60">({selectedDataDate})</span>
              </h2>
              <p className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
                Tracks in playlists that don't have stream data in the catalog snapshot for this day
              </p>
            </div>
            {allMissingTracks.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs opacity-60">{allMissingTracks.length} tracks</span>
                <ExportMissingTracksButton tracks={allMissingTracks} date={selectedDataDate ?? "—"} />
              </div>
            )}
          </div>
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
            ) : (
              <TableRow>
                <TableCell className="text-center opacity-50 py-8" colSpan={3}>
                  No missing catalog tracks found for {selectedDataDate}.
                </TableCell>
              </TableRow>
            )}
          </GlassTable>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center gap-2 px-1">
          <h2 className="text-sm font-semibold">Ingestion Runs (30d)</h2>
        </div>
        <GlassTable headers={["Run Date", "Status", "Logs"]}>
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
          {!runs?.length && (
            <TableRow>
              <TableCell className="text-center opacity-50 py-8" colSpan={3}>
                No ingestion runs yet.
              </TableCell>
            </TableRow>
          )}
        </GlassTable>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-sm font-semibold">
            Raw Exports{" "}
            {selectedDataDate ? (
              <span className="text-xs font-normal opacity-60">({selectedDataDate})</span>
            ) : null}
          </h2>
          <span className="text-xs opacity-50">Signed links (60s)</span>
        </div>
        <GlassTable headers={["Playlist", "Rows", "Exported", "Download"]}>
          {(exportsForLatest ?? []).map((r) => (
            <TableRow key={r.playlist_key}>
              <TableCell mono className="text-xs">
                {r.playlist_key}
              </TableCell>
              <TableCell>{r.rows_count ?? "—"}</TableCell>
              <TableCell mono className="text-xs">
                {r.exported_at ? new Date(r.exported_at).toLocaleString() : "—"}
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
                  "—"
                )}
              </TableCell>
            </TableRow>
          ))}
          {!exportsForLatest?.length && (
            <TableRow>
              <TableCell className="text-center opacity-50 py-8" colSpan={4}>
                No raw exports found for this run.
              </TableCell>
            </TableRow>
          )}
        </GlassTable>
      </div>
    </div>
  );
}

