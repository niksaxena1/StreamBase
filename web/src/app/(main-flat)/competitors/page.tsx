import { PreviewableArtwork } from "@/components/ui/PreviewableArtwork";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { normalizeDatasetMode } from "@/lib/datasetMode";
import { PageHeader } from "@/components/shell/PageHeader";
import { GlassTable, TableCell, TableRow } from "@/components/ui/GlassTable";
import { formatDateISO, formatInt } from "@/lib/format";
import { addDaysISO, dataDateFromRunDate } from "@/lib/sotDates";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Competitors",
};

type LabelRow = {
  label_key: string;
  display_name: string;
  is_active: boolean;
  accent_hex: string | null;
};

type PlaylistRow = {
  playlist_key: string;
  label_key: string;
  display_name: string;
  spotify_playlist_image_url: string | null;
  sot_dashboard_url: string;
  display_order: number | null;
  is_active: boolean;
};

type PlaylistStatSnapshot = {
  date: string;
  track_count: number | null;
  total_streams_cumulative: number | null;
  missing_streams_track_count: number | null;
  daily_streams_net: number | null;
};

type RawExportRow = {
  playlist_key: string;
  rows_count: number;
  exported_at: string;
};

type StatsLastTwoRow = {
  playlist_key: string;
  snapshot_rank: number;
  date: string;
  track_count: number | null;
  total_streams_cumulative: number | null;
  missing_streams_track_count: number | null;
  daily_streams_net: number | null;
};

type StatsAsOfRow = {
  playlist_key: string;
  date: string;
  track_count: number | null;
  total_streams_cumulative: number | null;
  missing_streams_track_count: number | null;
  daily_streams_net: number | null;
};

type LabelArtistCountRow = {
  label_key: string;
  artist_count: number | string;
};

function labelSummaryCardStyle(accentHex: string | null): CSSProperties {
  const clean = accentHex?.replace(/^#/, "").toLowerCase();
  if (!clean || !/^[0-9a-f]{6}$/.test(clean)) {
    return { borderLeft: "3px solid var(--sb-border)" };
  }
  return {
    borderLeft: `3px solid #${clean}`,
    background: `color-mix(in srgb, #${clean} 10%, transparent)`,
  };
}

function fmtMaybeDate(value: string | null | undefined) {
  return value ? formatDateISO(value.slice(0, 10)) : "—";
}

function parseCount(value: number | string | null | undefined): number {
  if (value == null) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  }
  return 0;
}

function sumPlaylistStat(
  playlistKeys: string[],
  snapshotsByPlaylist: Map<string, { latest: PlaylistStatSnapshot | null; previous: PlaylistStatSnapshot | null }>,
  field: "track_count" | "daily_streams_net",
  which: "latest" | "previous",
): number {
  let sum = 0;
  for (const key of playlistKeys) {
    const snap = snapshotsByPlaylist.get(key)?.[which];
    if (!snap) continue;
    const raw = snap[field];
    if (typeof raw === "number" && Number.isFinite(raw)) sum += raw;
  }
  return sum;
}

function sumStatField(
  playlistKeys: string[],
  statByPlaylist: Map<string, PlaylistStatSnapshot>,
  field: "track_count" | "daily_streams_net",
): number {
  let sum = 0;
  for (const key of playlistKeys) {
    const snap = statByPlaylist.get(key);
    if (!snap) continue;
    const raw = snap[field];
    if (typeof raw === "number" && Number.isFinite(raw)) sum += raw;
  }
  return sum;
}

function formatDelta(delta: number | null): string | null {
  if (delta == null || delta === 0) return null;
  return `${delta > 0 ? "+" : ""}${formatInt(delta)}`;
}

function deltaColor(delta: number | null): string {
  if (delta == null || delta === 0) return "var(--sb-muted)";
  if (delta > 0) return "var(--sb-positive)";
  return "var(--sb-negative, #ef4444)";
}

function DeltaLine({
  delta,
  periodLabel,
  title,
}: {
  delta: number;
  periodLabel: string;
  title: string;
}) {
  const deltaLabel = formatDelta(delta);
  if (!deltaLabel) return null;
  return (
    <div
      className="flex items-baseline gap-1 font-mono text-[10px] tabular-nums"
      style={{ color: deltaColor(delta) }}
      title={title}
    >
      <span>{deltaLabel}</span>
      <span className="font-sans text-[9px] font-medium uppercase opacity-55">{periodLabel}</span>
    </div>
  );
}

function LabelStat({
  label,
  value,
  delta,
  weeklyDelta,
}: {
  label: string;
  value: number;
  delta: number | null;
  weeklyDelta?: number | null;
}) {
  const showDeltas = formatDelta(delta) || (weeklyDelta != null && weeklyDelta !== 0);
  return (
    <div>
      <div className="text-[11px] uppercase opacity-60">{label}</div>
      <div className="font-mono">{formatInt(value)}</div>
      {showDeltas ? (
        <div className="mt-0.5 space-y-0.5">
          {formatDelta(delta) ? (
            <DeltaLine delta={delta!} periodLabel="1d" title="Change vs prior snapshot day" />
          ) : null}
          {weeklyDelta != null && weeklyDelta !== 0 ? (
            <DeltaLine delta={weeklyDelta} periodLabel="7d" title="Change vs snapshot about 7 days ago" />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default async function CompetitorsPage() {
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
  if (normalizeDatasetMode(settings?.dataset_mode) !== "competitor") redirect("/");

  const comp = svc.schema("competitor");

  const [
    { data: labelsRaw },
    { data: playlistsRaw },
    { data: statsLastTwoRaw },
    { data: rawExportsRaw },
    { data: recentRunsRaw },
  ] = await Promise.all([
    comp.from("labels").select("label_key,display_name,is_active,accent_hex").order("display_name", { ascending: true }),
    comp
      .from("playlists")
      .select("playlist_key,label_key,display_name,spotify_playlist_image_url,sot_dashboard_url,display_order,is_active")
      .order("display_order", { ascending: true, nullsFirst: false })
      .order("display_name", { ascending: true }),
    comp.rpc("playlist_daily_stats_last_two"),
    comp.rpc("latest_raw_exports_by_playlist"),
    comp.from("ingestion_runs").select("run_date,status,started_at,finished_at").order("run_date", { ascending: false }).limit(2),
  ]);

  const recentRuns = (recentRunsRaw ?? []) as Array<{ run_date: string }>;
  const latestRunDate = recentRuns[0]?.run_date ?? null;
  const previousRunDate = recentRuns[1]?.run_date ?? null;
  const weekAgoRunDate = latestRunDate ? addDaysISO(latestRunDate, -7) : null;

  const [
    { data: warningRowsRaw },
    { data: artistCountsRaw },
    { data: previousArtistCountsRaw },
    { data: weekAgoStatsRaw },
    { data: weekAgoArtistCountsRaw },
  ] = await Promise.all([
    latestRunDate
      ? comp.from("ingestion_warnings").select("playlist_key,severity").eq("run_date", latestRunDate)
      : Promise.resolve({ data: [] }),
    latestRunDate
      ? comp.rpc("label_distinct_artist_counts", { p_run_date: latestRunDate })
      : Promise.resolve({ data: [] }),
    previousRunDate
      ? comp.rpc("label_distinct_artist_counts", { p_run_date: previousRunDate })
      : Promise.resolve({ data: [] }),
    weekAgoRunDate
      ? comp.rpc("playlist_daily_stats_as_of", { p_as_of_date: weekAgoRunDate })
      : Promise.resolve({ data: [] }),
    weekAgoRunDate
      ? comp.rpc("label_distinct_artist_counts", { p_run_date: weekAgoRunDate })
      : Promise.resolve({ data: [] }),
  ]);

  const labels = (labelsRaw ?? []) as LabelRow[];
  const playlists = (playlistsRaw ?? []) as PlaylistRow[];

  const snapshotsByPlaylist = new Map<string, { latest: PlaylistStatSnapshot | null; previous: PlaylistStatSnapshot | null }>();
  for (const row of (statsLastTwoRaw ?? []) as StatsLastTwoRow[]) {
    const entry = snapshotsByPlaylist.get(row.playlist_key) ?? { latest: null, previous: null };
    const snap: PlaylistStatSnapshot = {
      date: row.date,
      track_count: row.track_count,
      total_streams_cumulative: row.total_streams_cumulative,
      missing_streams_track_count: row.missing_streams_track_count,
      daily_streams_net: row.daily_streams_net,
    };
    if (row.snapshot_rank === 1) entry.latest = snap;
    else if (row.snapshot_rank === 2) entry.previous = snap;
    snapshotsByPlaylist.set(row.playlist_key, entry);
  }

  const latestStatByPlaylist = new Map<string, PlaylistStatSnapshot>();
  for (const [playlistKey, snaps] of snapshotsByPlaylist) {
    if (snaps.latest) latestStatByPlaylist.set(playlistKey, snaps.latest);
  }

  const latestExportByPlaylist = new Map<string, RawExportRow>();
  for (const row of (rawExportsRaw ?? []) as RawExportRow[]) {
    latestExportByPlaylist.set(row.playlist_key, row);
  }

  const warningCountByPlaylist = new Map<string, number>();
  for (const row of (warningRowsRaw ?? []) as Array<{ playlist_key: string | null; severity: string }>) {
    if (!row.playlist_key) continue;
    warningCountByPlaylist.set(row.playlist_key, (warningCountByPlaylist.get(row.playlist_key) ?? 0) + 1);
  }

  const artistCountByLabel = new Map<string, number>();
  for (const row of (artistCountsRaw ?? []) as LabelArtistCountRow[]) {
    artistCountByLabel.set(row.label_key, parseCount(row.artist_count));
  }

  const previousArtistCountByLabel = new Map<string, number>();
  for (const row of (previousArtistCountsRaw ?? []) as LabelArtistCountRow[]) {
    previousArtistCountByLabel.set(row.label_key, parseCount(row.artist_count));
  }

  const weekAgoStatByPlaylist = new Map<string, PlaylistStatSnapshot>();
  for (const row of (weekAgoStatsRaw ?? []) as StatsAsOfRow[]) {
    weekAgoStatByPlaylist.set(row.playlist_key, {
      date: row.date,
      track_count: row.track_count,
      total_streams_cumulative: row.total_streams_cumulative,
      missing_streams_track_count: row.missing_streams_track_count,
      daily_streams_net: row.daily_streams_net,
    });
  }

  const weekAgoArtistCountByLabel = new Map<string, number>();
  for (const row of (weekAgoArtistCountsRaw ?? []) as LabelArtistCountRow[]) {
    weekAgoArtistCountByLabel.set(row.label_key, parseCount(row.artist_count));
  }

  const hasWeekAgoSnapshots =
    weekAgoRunDate != null && ((weekAgoStatsRaw ?? []) as StatsAsOfRow[]).length > 0;

  const playlistsByLabel = new Map<string, PlaylistRow[]>();
  for (const playlist of playlists) {
    const rows = playlistsByLabel.get(playlist.label_key) ?? [];
    rows.push(playlist);
    playlistsByLabel.set(playlist.label_key, rows);
  }

  const summary = labels.map((label) => {
    const labelPlaylists = playlistsByLabel.get(label.label_key) ?? [];
    const playlistKeys = labelPlaylists.map((p) => p.playlist_key);
    const trackCount = sumPlaylistStat(playlistKeys, snapshotsByPlaylist, "track_count", "latest");
    const previousTrackCount = sumPlaylistStat(playlistKeys, snapshotsByPlaylist, "track_count", "previous");
    const dailyStreams = sumPlaylistStat(playlistKeys, snapshotsByPlaylist, "daily_streams_net", "latest");
    const previousDailyStreams = sumPlaylistStat(playlistKeys, snapshotsByPlaylist, "daily_streams_net", "previous");
    const weekAgoTrackCount = sumStatField(playlistKeys, weekAgoStatByPlaylist, "track_count");
    const artistCount = artistCountByLabel.get(label.label_key) ?? 0;
    const previousArtistCount = previousArtistCountByLabel.get(label.label_key) ?? 0;
    const weekAgoArtistCount = weekAgoArtistCountByLabel.get(label.label_key) ?? 0;

    const hasPreviousSnapshots = playlistKeys.some((key) => snapshotsByPlaylist.get(key)?.previous);
    const hasWeekAgoSnapshots =
      weekAgoRunDate != null && playlistKeys.some((key) => weekAgoStatByPlaylist.has(key));

    return {
      label,
      playlists: labelPlaylists,
      trackCount,
      artistCount,
      dailyStreams,
      trackDelta: hasPreviousSnapshots ? trackCount - previousTrackCount : null,
      trackWeeklyDelta: hasWeekAgoSnapshots ? trackCount - weekAgoTrackCount : null,
      artistDelta: previousRunDate != null ? artistCount - previousArtistCount : null,
      artistWeeklyDelta: hasWeekAgoSnapshots ? artistCount - weekAgoArtistCount : null,
      dailyStreamDelta: hasPreviousSnapshots ? dailyStreams - previousDailyStreams : null,
    };
  });

  let subtitle: ReactNode = "No competitor ingestion run found yet.";
  if (latestRunDate) {
    subtitle = (
      <>
        Latest competitor run: <span className="font-mono">{formatDateISO(dataDateFromRunDate(latestRunDate))}</span>
        {previousRunDate ? (
          <span className="opacity-70">
            {" "}
            · 1d vs <span className="font-mono">{formatDateISO(dataDateFromRunDate(previousRunDate))}</span>
          </span>
        ) : null}
        {hasWeekAgoSnapshots && weekAgoRunDate ? (
          <span className="opacity-70">
            {" "}
            · 7d vs <span className="font-mono">{formatDateISO(dataDateFromRunDate(weekAgoRunDate))}</span>
          </span>
        ) : null}
      </>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Competitors" subtitle={subtitle} />

      <div className="grid gap-3 md:grid-cols-3">
        {summary.map(
          ({
            label,
            playlists: labelPlaylists,
            trackCount,
            artistCount,
            dailyStreams,
            trackDelta,
            trackWeeklyDelta,
            artistDelta,
            artistWeeklyDelta,
            dailyStreamDelta,
          }) => {
          const imageUrl = labelPlaylists.find((playlist) => playlist.spotify_playlist_image_url)?.spotify_playlist_image_url ?? null;
          return (
            <div key={label.label_key} className="sb-card p-4" style={labelSummaryCardStyle(label.accent_hex)}>
              <div className="flex items-center gap-3">
                {imageUrl ? (
                  <PreviewableArtwork
                    src={imageUrl}
                    alt={label.display_name}
                    width={44}
                    height={44}
                    className="h-11 w-11 rounded-xl object-cover sb-ring"
                    label={label.display_name}
                  />
                ) : (
                  <div className="h-11 w-11 rounded-xl bg-white/10 sb-ring" />
                )}
                <div>
                  <div className="font-display text-lg font-semibold">{label.display_name}</div>
                  <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
                    {labelPlaylists.length} playlist{labelPlaylists.length === 1 ? "" : "s"}
                  </div>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
                <LabelStat label="Tracks" value={trackCount} delta={trackDelta} weeklyDelta={trackWeeklyDelta} />
                <LabelStat label="Artists" value={artistCount} delta={artistDelta} weeklyDelta={artistWeeklyDelta} />
                <LabelStat label="Daily streams" value={dailyStreams} delta={dailyStreamDelta} />
              </div>
            </div>
          );
        },
        )}
      </div>

      <div className="sb-card p-4">
        <div className="mb-3 text-xs font-medium uppercase tracking-wider opacity-60">Playlist health</div>
        <GlassTable headers={["", "Competitor", "Playlist", "Tracks", "Rows", "Missing totals", "Warnings", "Latest export", ""]}>
          {playlists.map((playlist) => {
            const stat = latestStatByPlaylist.get(playlist.playlist_key);
            const exportRow = latestExportByPlaylist.get(playlist.playlist_key);
            const label = labels.find((row) => row.label_key === playlist.label_key);
            const rowsMatch =
              stat?.track_count != null && exportRow?.rows_count != null
                ? Number(stat.track_count) === Number(exportRow.rows_count)
                : null;
            return (
              <TableRow key={playlist.playlist_key}>
                <TableCell>
                  {playlist.spotify_playlist_image_url ? (
                    <PreviewableArtwork
                      src={playlist.spotify_playlist_image_url}
                      alt={playlist.display_name}
                      width={32}
                      height={32}
                      className="h-8 w-8 rounded-lg object-cover sb-ring"
                      label={playlist.display_name}
                    />
                  ) : (
                    <div className="h-8 w-8 rounded-lg bg-white/10 sb-ring" />
                  )}
                </TableCell>
                <TableCell>{label?.display_name ?? playlist.label_key}</TableCell>
                <TableCell>
                  <Link href={`/playlists?playlist_key=${encodeURIComponent(playlist.playlist_key)}`} className="sb-link-hover font-medium">
                    {playlist.display_name}
                  </Link>
                </TableCell>
                <TableCell numeric>{stat?.track_count == null ? "—" : formatInt(stat.track_count)}</TableCell>
                <TableCell numeric>
                  <span className={rowsMatch === false ? "text-amber-500" : ""}>
                    {exportRow?.rows_count == null ? "—" : formatInt(exportRow.rows_count)}
                  </span>
                </TableCell>
                <TableCell numeric>{stat?.missing_streams_track_count == null ? "—" : formatInt(stat.missing_streams_track_count)}</TableCell>
                <TableCell numeric>{formatInt(warningCountByPlaylist.get(playlist.playlist_key) ?? 0)}</TableCell>
                <TableCell>{fmtMaybeDate(exportRow?.exported_at)}</TableCell>
                <TableCell>
                  <a href={playlist.sot_dashboard_url} target="_blank" rel="noreferrer" className="sb-link-hover text-xs">
                    SpotOnTrack
                  </a>
                </TableCell>
              </TableRow>
            );
          })}
        </GlassTable>
      </div>
    </div>
  );
}
