import Link from "next/link";

import { CACHE_TTL_1H } from "@/lib/constants";
import { formatDateISO, formatInt } from "@/lib/format";
import { addDaysISO, dataDateFromRunDate } from "@/lib/sotDates";
import { cachedQuery } from "@/lib/supabase/cache";
import { supabaseService } from "@/lib/supabase/service";

import { GlassTable, TableRow, TableCell, EmptyState } from "@/components/ui/GlassTable";
import { RefreshButton } from "@/components/health/RefreshButton";
import { PageHeader } from "@/components/shell/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { PreviewableArtwork } from "@/components/ui/PreviewableArtwork";

type CompetitorPlaylistRow = {
  playlist_key: string;
  label_key: string;
  display_name: string;
  spotify_playlist_image_url: string | null;
  is_active: boolean;
};

type CompetitorStatRow = {
  date: string;
  playlist_key: string;
  track_count: number | null;
  total_streams_cumulative: number | null;
  daily_streams_net: number | null;
  missing_streams_track_count: number | null;
};

type CompetitorExportRow = {
  playlist_key: string;
  rows_count: number | null;
  exported_at: string | null;
};

export async function CompetitorHealthSection() {
  const cached = await cachedQuery(
    async () => {
      const svc = supabaseService();
      const comp = svc.schema("competitor");

      const { data: latestRunRow, error: latestRunErr } = await comp
        .from("ingestion_runs")
        .select("run_date")
        .order("run_date", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestRunErr) return { data: null, error: latestRunErr };

      const latestRunDate = String((latestRunRow as { run_date?: string } | null)?.run_date ?? "").slice(0, 10);
      const prevRunDate = latestRunDate ? addDaysISO(latestRunDate, -1) : null;

      const [
        { data: runsRaw, error: runsErr },
        { data: playlistsRaw },
        { data: statsRaw },
        { data: exportsRaw },
        { data: warningsRaw },
        { count: unenrichedCount },
      ] = await Promise.all([
        comp
          .from("ingestion_runs")
          .select("id,run_date,status,started_at,finished_at")
          .order("run_date", { ascending: false })
          .limit(14),
        comp
          .from("playlists")
          .select("playlist_key,label_key,display_name,spotify_playlist_image_url,is_active")
          .order("label_key", { ascending: true })
          .order("display_order", { ascending: true, nullsFirst: false }),
        latestRunDate && prevRunDate
          ? comp
              .from("playlist_daily_stats")
              .select(
                "date,playlist_key,track_count,total_streams_cumulative,daily_streams_net,missing_streams_track_count",
              )
              .in("date", [prevRunDate, latestRunDate])
          : Promise.resolve({ data: [] as CompetitorStatRow[], error: null }),
        latestRunDate
          ? comp
              .from("raw_exports")
              .select("playlist_key,rows_count,exported_at")
              .eq("run_date", latestRunDate)
              .order("exported_at", { ascending: false })
          : Promise.resolve({ data: [] as CompetitorExportRow[], error: null }),
        comp
          .from("ingestion_warnings")
          .select("playlist_key,severity,code,message,created_at")
          .order("created_at", { ascending: false })
          .limit(100),
        comp
          .from("tracks")
          .select("isrc", { count: "exact", head: true })
          .or("spotify_artist_ids.is.null,spotify_album_image_url.is.null"),
      ]);

      if (runsErr) return { data: null, error: runsErr };

      return {
        data: {
          runs: (runsRaw ?? []) as Array<Record<string, unknown>>,
          playlists: (playlistsRaw ?? []) as CompetitorPlaylistRow[],
          stats: (statsRaw ?? []) as CompetitorStatRow[],
          exportsRows: (exportsRaw ?? []) as CompetitorExportRow[],
          warningsRaw: warningsRaw ?? [],
          unenrichedCount: unenrichedCount ?? 0,
          latestRunDate: latestRunDate || null,
        },
        error: null,
      };
    },
    "health-competitor-bundle",
    CACHE_TTL_1H,
  );

  if (cached.error) {
    return (
      <Alert variant="error" title="Query error">
        {cached.error.message}
      </Alert>
    );
  }

  const runs = cached.data?.runs ?? [];
  const playlists = cached.data?.playlists ?? [];
  const stats = cached.data?.stats ?? [];
  const exportsRows = cached.data?.exportsRows ?? [];
  const warningsRaw = cached.data?.warningsRaw ?? [];
  const unenrichedCount = cached.data?.unenrichedCount ?? 0;
  const latestRunDate = cached.data?.latestRunDate ?? null;

  const latestStatByPlaylist = new Map<string, CompetitorStatRow>();
  for (const stat of stats) {
    if (!latestStatByPlaylist.has(stat.playlist_key)) latestStatByPlaylist.set(stat.playlist_key, stat);
  }
  const previousStatByPlaylist = new Map<string, CompetitorStatRow>();
  for (const stat of stats) {
    if (latestStatByPlaylist.get(stat.playlist_key)?.date === stat.date) continue;
    if (!previousStatByPlaylist.has(stat.playlist_key)) previousStatByPlaylist.set(stat.playlist_key, stat);
  }
  const latestExportByPlaylist = new Map<string, CompetitorExportRow>();
  for (const row of exportsRows) {
    if (!latestExportByPlaylist.has(row.playlist_key)) latestExportByPlaylist.set(row.playlist_key, row);
  }

  const failedRuns = runs.filter((run) => run.status !== "success").length;
  const missingTotals = [...latestStatByPlaylist.values()].reduce(
    (sum, stat) => sum + Number(stat.missing_streams_track_count ?? 0),
    0,
  );
  const activePlaylists = playlists.filter((playlist) => playlist.is_active !== false);
  const stalePlaylists = activePlaylists.filter(
    (playlist) => latestStatByPlaylist.get(playlist.playlist_key)?.date !== latestRunDate,
  );
  const rowMismatches = activePlaylists.filter((playlist) => {
    const stat = latestStatByPlaylist.get(playlist.playlist_key);
    const exp = latestExportByPlaylist.get(playlist.playlist_key);
    return stat?.track_count != null && exp?.rows_count != null && Number(stat.track_count) !== Number(exp.rows_count);
  });
  const warningCount = warningsRaw.length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Competitor Health"
        subtitle={
          latestRunDate
            ? `Competitor pipeline checks. Last ingested: ${formatDateISO(dataDateFromRunDate(latestRunDate))}`
            : "Competitor pipeline checks."
        }
        actions={<RefreshButton />}
      />

      <div className="grid gap-3 md:grid-cols-5">
        {[
          ["Failed runs", failedRuns],
          ["Stale playlists", stalePlaylists.length],
          ["Row mismatches", rowMismatches.length],
          ["Missing totals", missingTotals],
          ["Unenriched tracks", unenrichedCount],
        ].map(([label, value]) => (
          <div key={label as string} className="sb-card p-4">
            <div className="text-[11px] uppercase tracking-wider opacity-60">{label}</div>
            <div className="mt-1 font-display text-2xl font-semibold">{formatInt(Number(value ?? 0))}</div>
          </div>
        ))}
      </div>

      <CollapsibleSection title="Playlist Checks" storageKey="sb:health:competitor:playlist_checks">
        <GlassTable headers={["Playlist", "Latest", "Tracks", "Rows", "Daily", "Missing totals", "Status"]}>
          {activePlaylists.map((playlist) => {
            const stat = latestStatByPlaylist.get(playlist.playlist_key);
            const prev = previousStatByPlaylist.get(playlist.playlist_key);
            const exportRow = latestExportByPlaylist.get(playlist.playlist_key);
            const stale = stat?.date !== latestRunDate;
            const rowMismatch =
              stat?.track_count != null &&
              exportRow?.rows_count != null &&
              Number(stat.track_count) !== Number(exportRow.rows_count);
            const swing =
              stat?.track_count != null && prev?.track_count != null
                ? Number(stat.track_count) - Number(prev.track_count)
                : 0;
            const bad = stale || rowMismatch || Number(stat?.missing_streams_track_count ?? 0) > 0;
            return (
              <TableRow key={playlist.playlist_key}>
                <TableCell>
                  <div className="flex min-w-0 items-center gap-2">
                    {playlist.spotify_playlist_image_url ? (
                      <PreviewableArtwork
                        src={playlist.spotify_playlist_image_url}
                        alt=""
                        width={32}
                        height={32}
                        className="h-8 w-8 flex-shrink-0 rounded object-cover sb-ring"
                        label={playlist.display_name}
                      />
                    ) : (
                      <div className="h-8 w-8 flex-shrink-0 rounded bg-white/10 sb-ring" />
                    )}
                    <div className="min-w-0">
                      <Link
                        href={`/playlists?playlist_key=${encodeURIComponent(playlist.playlist_key)}`}
                        className="block truncate font-medium hover:underline"
                      >
                        {playlist.display_name}
                      </Link>
                      <div className="truncate text-[10px] opacity-60">{playlist.label_key}</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell mono>{stat?.date ? formatDateISO(dataDateFromRunDate(stat.date)) : "—"}</TableCell>
                <TableCell numeric>
                  {stat?.track_count == null ? "—" : formatInt(stat.track_count)}
                  {swing ? (
                    <span className={swing > 0 ? "ml-1 text-lime-500" : "ml-1 text-red-500"}>
                      ({swing > 0 ? "+" : ""}
                      {formatInt(swing)})
                    </span>
                  ) : null}
                </TableCell>
                <TableCell numeric className={rowMismatch ? "text-amber-500" : ""}>
                  {exportRow?.rows_count == null ? "—" : formatInt(exportRow.rows_count)}
                </TableCell>
                <TableCell numeric>{stat?.daily_streams_net == null ? "—" : formatInt(stat.daily_streams_net)}</TableCell>
                <TableCell numeric>
                  {stat?.missing_streams_track_count == null ? "—" : formatInt(stat.missing_streams_track_count)}
                </TableCell>
                <TableCell>
                  <span
                    className={[
                      "inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium",
                      bad
                        ? "bg-amber-500/20 text-amber-700 dark:text-amber-300"
                        : "bg-lime-500/20 text-lime-700 dark:text-lime-300",
                    ].join(" ")}
                  >
                    {bad ? "check" : "ok"}
                  </span>
                </TableCell>
              </TableRow>
            );
          })}
          {!activePlaylists.length ? (
            <EmptyState colSpan={7} message="No competitor playlists configured." />
          ) : null}
        </GlassTable>
      </CollapsibleSection>

      <CollapsibleSection title="Competitor Ingestion Runs" storageKey="sb:health:competitor:ingestion_runs">
        <GlassTable headers={["Run Date", "Status", "Started", "Finished"]}>
          {runs.map((run) => (
            <TableRow key={run.run_date as string}>
              <TableCell mono>{formatDateISO(dataDateFromRunDate(run.run_date as string))}</TableCell>
              <TableCell>{String(run.status ?? "—")}</TableCell>
              <TableCell mono>{run.started_at ? new Date(run.started_at as string).toLocaleString() : "—"}</TableCell>
              <TableCell mono>{run.finished_at ? new Date(run.finished_at as string).toLocaleString() : "—"}</TableCell>
            </TableRow>
          ))}
          {!runs.length ? <EmptyState colSpan={4} message="No competitor ingestion runs yet." /> : null}
        </GlassTable>
      </CollapsibleSection>

      <CollapsibleSection title={`Recent Competitor Warnings (${warningCount})`} storageKey="sb:health:competitor:warnings">
        <GlassTable headers={["Created", "Playlist", "Severity", "Code", "Message"]}>
          {(warningsRaw as Array<Record<string, unknown>>).map((warning, idx) => (
            <TableRow key={`${warning.created_at}-${idx}`}>
              <TableCell mono>
                {warning.created_at ? new Date(warning.created_at as string).toLocaleString() : "—"}
              </TableCell>
              <TableCell>{String(warning.playlist_key ?? "—")}</TableCell>
              <TableCell>{String(warning.severity ?? "—")}</TableCell>
              <TableCell mono>{String(warning.code ?? "—")}</TableCell>
              <TableCell>{String(warning.message ?? "—")}</TableCell>
            </TableRow>
          ))}
          {!warningCount ? <EmptyState colSpan={5} message="No competitor warnings." /> : null}
        </GlassTable>
      </CollapsibleSection>
    </div>
  );
}
