import Link from "next/link";

import { formatDateISO } from "@/lib/format";
import { supabaseServer } from "@/lib/supabase/server";
import { GlassTable, TableRow, TableCell } from "@/components/ui/GlassTable";
import { WarningRow } from "@/components/health/WarningRow";
import { ArtistLinks } from "@/components/ui/ArtistLinks";

export const dynamic = "force-dynamic";

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
  searchParams?: Promise<{ severity?: string; playlist?: string; date?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const severityFilter = sp.severity ?? "all";
  const playlistFilter = sp.playlist ?? "all";
  const dateFilter = sp.date;

  const sb = await supabaseServer();

  const { data: runs, error: runsErr } = await sb
    .from("ingestion_runs")
    .select("id,run_date,status,logs_url,started_at,finished_at")
    .order("run_date", { ascending: false })
    .limit(30);

  // Determine which date to show (from filter or latest)
  const latestDate = runs?.[0]?.run_date ?? null;
  const selectedDate = dateFilter ?? latestDate;

  // Get run ID for selected date
  const selectedRun = runs?.find((r) => r.run_date === selectedDate);
  const selectedRunId = selectedRun?.id ?? null;

  const { data: exportsForLatest, error: exportsErr } = selectedRunId
    ? await sb
        .from("raw_exports")
        .select("playlist_key,storage_bucket,object_key,rows_count,file_sha256,exported_at")
        .eq("run_id", selectedRunId)
        .order("playlist_key", { ascending: true })
    : { data: [], error: null };

  // Build warnings query with filters
  let warningsQuery = sb
    .from("ingestion_warnings")
    .select("severity,code,playlist_key,message,run_date")
    .order("severity", { ascending: false })
    .order("playlist_key", { ascending: true });

  if (selectedDate) {
    warningsQuery = warningsQuery.eq("run_date", selectedDate);
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
    (w) => w.code === "non_catalog_tracks_present" && w.playlist_key && selectedDate
  );

  const nonCatalogTracksMap = new Map<string, Array<{ isrc: string; name: string | null }>>();

  if (nonCatalogWarnings.length > 0 && selectedDate) {
    for (const warning of nonCatalogWarnings) {
      if (!warning.playlist_key) continue;

      // Get all tracks in the playlist on the selected date
      const { data: memberships } = await sb
        .from("playlist_memberships")
        .select("isrc")
        .eq("playlist_key", warning.playlist_key)
        .lte("valid_from", selectedDate)
        .or(`valid_to.is.null,valid_to.gte.${selectedDate}`);

      const playlistIsrcs = new Set((memberships ?? []).map((m) => m.isrc));

      // Get all tracks that have catalog stream snapshots on the selected date
      const { data: catalogStreams } = await sb
        .from("track_daily_streams")
        .select("isrc")
        .eq("date", selectedDate);

      const catalogIsrcs = new Set((catalogStreams ?? []).map((s) => s.isrc));

      // Find tracks in playlist but not in catalog
      const nonCatalogIsrcs = Array.from(playlistIsrcs).filter((isrc) => !catalogIsrcs.has(isrc));

      if (nonCatalogIsrcs.length > 0) {
        // Fetch track names, artist names, artist IDs, and album images
        const { data: tracks } = await sb
          .from("tracks")
          .select("isrc,name,spotify_artist_names,spotify_artist_ids,spotify_album_image_url")
          .in("isrc", nonCatalogIsrcs);

        nonCatalogTracksMap.set(warning.playlist_key ?? "", (tracks ?? []).map((t) => ({ 
          isrc: t.isrc, 
          name: t.name,
          artist_names: t.spotify_artist_names,
          artist_ids: t.spotify_artist_ids,
          album_image_url: t.spotify_album_image_url,
        })));
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

  if (selectedDate) {
    // Get all tracks in all playlists on the selected date
    const { data: allMemberships } = await sb
      .from("playlist_memberships")
      .select("isrc,playlist_key")
      .lte("valid_from", selectedDate)
      .or(`valid_to.is.null,valid_to.gte.${selectedDate}`);

    // Get all tracks that have catalog stream snapshots on the selected date
    const { data: catalogStreamsAll } = await sb
      .from("track_daily_streams")
      .select("isrc")
      .eq("date", selectedDate);

    const catalogIsrcsAll = new Set((catalogStreamsAll ?? []).map((s) => s.isrc));

    // Group by ISRC and collect playlist keys
    const isrcToPlaylists = new Map<string, Set<string>>();
    for (const m of allMemberships ?? []) {
      if (!catalogIsrcsAll.has(m.isrc)) {
        if (!isrcToPlaylists.has(m.isrc)) {
          isrcToPlaylists.set(m.isrc, new Set());
        }
        isrcToPlaylists.get(m.isrc)!.add(m.playlist_key);
      }
    }

    const missingIsrcs = Array.from(isrcToPlaylists.keys());
    if (missingIsrcs.length > 0) {
      // Fetch track metadata
      const { data: tracks } = await sb
        .from("tracks")
        .select("isrc,name,spotify_artist_names,spotify_artist_ids,spotify_album_image_url")
        .in("isrc", missingIsrcs);

      allMissingTracks = (tracks ?? []).map((t) => ({
        isrc: t.isrc,
        name: t.name,
        artist_names: t.spotify_artist_names,
        artist_ids: t.spotify_artist_ids,
        album_image_url: t.spotify_album_image_url,
        playlists: Array.from(isrcToPlaylists.get(t.isrc) ?? []).sort(),
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
  const firstDate = runs?.[runs.length - 1]?.run_date ?? selectedDate ?? new Date().toISOString().split("T")[0];
  const today = new Date().toISOString().split("T")[0];

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
        <div className="sb-ring flex items-center gap-0.5 rounded-full bg-white/70 p-0.5 text-xs">
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
            {selectedDate ? (
              <span className="text-xs font-normal opacity-60">({selectedDate})</span>
            ) : null}
          </h2>
          <Link className="text-xs underline opacity-60" href="/playlists">
            View playlists
          </Link>
        </div>
        <GlassTable headers={["Severity", "Code", "Playlist", "Message"]}>
          {(warnings ?? []).map((w, i) => (
            <WarningRow
              key={`${w.code}-${w.playlist_key ?? "global"}-${i}`}
              warning={w}
              nonCatalogTracks={w.code === "non_catalog_tracks_present" && w.playlist_key
                ? nonCatalogTracksMap.get(w.playlist_key)
                : undefined}
            />
          ))}
          {!warnings?.length && (
            <TableRow>
              <TableCell className="text-center opacity-50 py-8" colSpan={4}>
                No warnings found for the selected filters.
              </TableCell>
            </TableRow>
          )}
        </GlassTable>
      </div>

      {selectedDate && (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <div>
              <h2 className="text-sm font-semibold">
                All Missing Catalog Tracks{" "}
                <span className="text-xs font-normal opacity-60">({selectedDate})</span>
              </h2>
              <p className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
                Tracks in playlists that don't have stream data in the catalog snapshot for this day
              </p>
            </div>
            {allMissingTracks.length > 0 && (
              <span className="text-xs opacity-60">{allMissingTracks.length} tracks</span>
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
                  No missing catalog tracks found for {selectedDate}.
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
              <TableCell mono>{formatDateISO(r.run_date)}</TableCell>
              <TableCell>
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    r.status === "success" ? "" : "bg-black/6 dark:bg-white/6"
                  }`}
                  style={{
                    background:
                      r.status === "success"
                        ? "rgba(199, 243, 60, 0.2)"
                        : undefined,
                    color: r.status === "success" ? "#4d6600" : "inherit",
                  }}
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
            {selectedDate ? (
              <span className="text-xs font-normal opacity-60">({selectedDate})</span>
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

