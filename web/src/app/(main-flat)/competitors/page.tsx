import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { normalizeDatasetMode } from "@/lib/datasetMode";
import { PageHeader } from "@/components/shell/PageHeader";
import { formatDateISO } from "@/lib/format";
import { addDaysISO, dataDateFromRunDate, runDateFromDataDate } from "@/lib/sotDates";
import { capRunDate, getRollbackDate, rollbackDataDateToRunDate } from "@/lib/rollback";

import { CompetitorsClient } from "./CompetitorsClient";
import type {
  ChurnRow,
  LabelRow,
  MoverTrackRow,
  OverlapCell,
  PlaylistRow,
} from "./competitorsTypes";
import {
  aggregateSeriesByLabel,
  buildLabelComparisonRows,
  buildStatsByDataDate,
  parseCount,
  sumLabelAtDataDate,
  type AnchoredStatRow,
  type StatsAsOfRow,
} from "./competitorsUtils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Competitors",
};

type LabelArtistCountRow = {
  label_key: string;
  artist_count: number | string;
};

function enrichChurnRows(
  rows: Array<{ label_key: string; added_count: number; removed_count: number; net: number }>,
  playlistsByLabel: Map<string, PlaylistRow[]>,
  statsByDataDate: ReturnType<typeof buildStatsByDataDate>,
  latestDataDate: string | null,
  weekAgoDataDate: string | null,
): ChurnRow[] {
  return rows.map((row) => {
    const keys = (playlistsByLabel.get(row.label_key) ?? []).map((p) => p.playlist_key);
    const latest = sumLabelAtDataDate(keys, latestDataDate, statsByDataDate, "track_count");
    const weekAgo = sumLabelAtDataDate(keys, weekAgoDataDate, statsByDataDate, "track_count");
    const track_count_delta_7d =
      latest != null && weekAgo != null ? latest - weekAgo : null;
    return { ...row, track_count_delta_7d };
  });
}

function parseMovers(raw: unknown): MoverTrackRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      isrc: String(r.isrc ?? ""),
      name: String(r.name ?? r.isrc ?? ""),
      album_image_url: (r.album_image_url as string | null) ?? null,
      artist_names: Array.isArray(r.artist_names) ? (r.artist_names as string[]) : null,
      artist_ids: Array.isArray(r.artist_ids) ? (r.artist_ids as string[]) : null,
      label_keys: Array.isArray(r.label_keys) ? (r.label_keys as string[]) : [],
      daily_delta: Number(r.daily_delta ?? 0),
      total: Number(r.total ?? 0),
    };
  });
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
    .select("dataset_mode,competitor_label_key")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (normalizeDatasetMode(settings?.dataset_mode) !== "competitor") redirect("/");

  const comp = svc.schema("competitor");
  const rollbackDate = await getRollbackDate();
  const rollbackRunDate = rollbackDate ? rollbackDataDateToRunDate(rollbackDate) : null;

  let recentRunsQuery = comp
    .from("ingestion_runs")
    .select("run_date,status,started_at,finished_at")
    .eq("status", "success")
    .order("run_date", { ascending: false })
    .limit(1);
  if (rollbackRunDate) recentRunsQuery = recentRunsQuery.lte("run_date", rollbackRunDate);

  const [{ data: labelsRaw }, { data: playlistsRaw }, { data: recentRunsRaw }] = await Promise.all([
    comp.from("labels").select("label_key,display_name,is_active,accent_hex").order("display_name", { ascending: true }),
    comp
      .from("playlists")
      .select("playlist_key,label_key,display_name,spotify_playlist_image_url,sot_dashboard_url,display_order,is_active")
      .order("display_order", { ascending: true, nullsFirst: false })
      .order("display_name", { ascending: true }),
    recentRunsQuery,
  ]);

  const labels = (labelsRaw ?? []) as LabelRow[];
  const playlists = (playlistsRaw ?? []) as PlaylistRow[];
  const playlistKeys = playlists.map((p) => p.playlist_key);
  const playlistToLabel = new Map(playlists.map((p) => [p.playlist_key, p.label_key]));

  const recentRuns = (recentRunsRaw ?? []) as Array<{ run_date: string }>;
  const latestRunDate = capRunDate(recentRuns[0]?.run_date?.slice(0, 10) ?? null, rollbackDate);
  const latestDataDate = latestRunDate ? dataDateFromRunDate(latestRunDate) : null;
  const previousDataDate = latestDataDate ? addDaysISO(latestDataDate, -1) : null;
  const weekAgoDataDate = latestDataDate ? addDaysISO(latestDataDate, -7) : null;

  const anchorDataDates = [...new Set([latestDataDate, previousDataDate, weekAgoDataDate].filter(Boolean) as string[])];
  const anchorRunDates = anchorDataDates.map((dataDate) => runDateFromDataDate(dataDate));

  const seriesStart = latestRunDate ? addDaysISO(latestRunDate, -90) : null;

  const [
    { data: anchoredStatsRaw },
    { data: labelSeriesRaw },
    { data: artistCountsRaw },
    { data: previousArtistCountsRaw },
    { data: weekAgoStatsRaw },
    { data: weekAgoArtistCountsRaw },
    gainersResult,
    losersResult,
    churn7dResult,
    churn30dResult,
    overlapResult,
  ] = await Promise.all([
    anchorRunDates.length > 0 && playlistKeys.length > 0
      ? comp
          .from("playlist_daily_stats")
          .select("playlist_key,date,track_count,total_streams_cumulative,missing_streams_track_count,daily_streams_net")
          .in("date", anchorRunDates)
          .in("playlist_key", playlistKeys)
      : Promise.resolve({ data: [] as AnchoredStatRow[] }),
    seriesStart && latestRunDate && playlistKeys.length > 0
      ? comp
          .from("playlist_daily_stats")
          .select("date,playlist_key,daily_streams_net,total_streams_cumulative,track_count")
          .gte("date", seriesStart)
          .lte("date", latestRunDate)
          .in("playlist_key", playlistKeys)
      : Promise.resolve({ data: [] }),
    latestDataDate
      ? comp.rpc("label_distinct_artist_counts", { p_run_date: runDateFromDataDate(latestDataDate) })
      : Promise.resolve({ data: [] }),
    previousDataDate
      ? comp.rpc("label_distinct_artist_counts", { p_run_date: runDateFromDataDate(previousDataDate) })
      : Promise.resolve({ data: [] }),
    weekAgoDataDate
      ? comp.rpc("playlist_daily_stats_as_of", { p_as_of_date: runDateFromDataDate(weekAgoDataDate) })
      : Promise.resolve({ data: [] }),
    weekAgoDataDate
      ? comp.rpc("label_distinct_artist_counts", { p_run_date: runDateFromDataDate(weekAgoDataDate) })
      : Promise.resolve({ data: [] }),
    latestRunDate
      ? comp.rpc("label_top_tracks_daily", {
          p_run_date: latestRunDate,
          p_limit: 15,
          p_direction: "gainers",
        })
      : Promise.resolve({ data: [] }),
    latestRunDate
      ? comp.rpc("label_top_tracks_daily", {
          p_run_date: latestRunDate,
          p_limit: 15,
          p_direction: "losers",
        })
      : Promise.resolve({ data: [] }),
    latestRunDate
      ? comp.rpc("label_membership_churn", { p_window_days: 7, p_as_of: latestRunDate })
      : Promise.resolve({ data: [] }),
    latestRunDate
      ? comp.rpc("label_membership_churn", { p_window_days: 30, p_as_of: latestRunDate })
      : Promise.resolve({ data: [] }),
    latestRunDate
      ? comp.rpc("label_overlap_matrix", { p_as_of: latestRunDate })
      : Promise.resolve({ data: [] }),
  ]);

  const statsByDataDate = buildStatsByDataDate((anchoredStatsRaw ?? []) as AnchoredStatRow[]);

  const artistCountByLabel = new Map<string, number>();
  for (const row of (artistCountsRaw ?? []) as LabelArtistCountRow[]) {
    artistCountByLabel.set(row.label_key, parseCount(row.artist_count));
  }

  const previousArtistCountByLabel = new Map<string, number>();
  for (const row of (previousArtistCountsRaw ?? []) as LabelArtistCountRow[]) {
    previousArtistCountByLabel.set(row.label_key, parseCount(row.artist_count));
  }

  const weekAgoArtistCountByLabel = new Map<string, number>();
  for (const row of (weekAgoArtistCountsRaw ?? []) as LabelArtistCountRow[]) {
    weekAgoArtistCountByLabel.set(row.label_key, parseCount(row.artist_count));
  }

  if (weekAgoDataDate) {
    const byPlaylist = statsByDataDate.get(weekAgoDataDate) ?? new Map();
    for (const row of (weekAgoStatsRaw ?? []) as StatsAsOfRow[]) {
      if (byPlaylist.has(row.playlist_key)) continue;
      const rowDataDate = dataDateFromRunDate(row.date.slice(0, 10));
      if (rowDataDate !== weekAgoDataDate) continue;
      byPlaylist.set(row.playlist_key, {
        date: weekAgoDataDate,
        track_count: row.track_count,
        total_streams_cumulative: row.total_streams_cumulative,
        missing_streams_track_count: row.missing_streams_track_count,
        daily_streams_net: row.daily_streams_net,
      });
    }
    statsByDataDate.set(weekAgoDataDate, byPlaylist);
  }

  const playlistsByLabel = new Map<string, PlaylistRow[]>();
  for (const playlist of playlists) {
    const rows = playlistsByLabel.get(playlist.label_key) ?? [];
    rows.push(playlist);
    playlistsByLabel.set(playlist.label_key, rows);
  }

  const labelSeries = aggregateSeriesByLabel(
    (labelSeriesRaw ?? []) as Array<{
      date: string;
      playlist_key: string;
      daily_streams_net: number | null;
      total_streams_cumulative: number | null;
      track_count: number | null;
    }>,
    playlistToLabel,
  );

  const comparisonRows = buildLabelComparisonRows({
    labels,
    playlistsByLabel,
    labelSeries,
    latestDataDate,
    previousDataDate,
    weekAgoDataDate,
    statsByDataDate,
    artistCountByLabel,
    previousArtistCountByLabel,
    weekAgoArtistCountByLabel,
  });

  const churn7d = enrichChurnRows(
    (churn7dResult.data ?? []) as Array<{ label_key: string; added_count: number; removed_count: number; net: number }>,
    playlistsByLabel,
    statsByDataDate,
    latestDataDate,
    weekAgoDataDate,
  );

  const churn30d = enrichChurnRows(
    (churn30dResult.data ?? []) as Array<{ label_key: string; added_count: number; removed_count: number; net: number }>,
    playlistsByLabel,
    statsByDataDate,
    latestDataDate,
    weekAgoDataDate,
  );

  const gainers = parseMovers(gainersResult.data);
  const losers = parseMovers(losersResult.data);
  const overlapCells = (overlapResult.data ?? []) as OverlapCell[];

  const playlistsByLabelRecord: Record<string, PlaylistRow[]> = {};
  for (const [key, rows] of playlistsByLabel) {
    playlistsByLabelRecord[key] = rows;
  }

  let subtitle: ReactNode = "No competitor data found yet.";
  if (latestDataDate) {
    subtitle = (
      <>
        Latest data date: <span className="font-mono">{formatDateISO(latestDataDate)}</span>
      </>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Competitors"
        subtitle={subtitle}
        actions={
          <Link href="/health" className="sb-link-hover text-xs whitespace-nowrap">
            Pipeline health &amp; ingestion status →
          </Link>
        }
      />

      {latestDataDate ? (
        <CompetitorsClient
          labels={labels}
          comparisonRows={comparisonRows}
          labelSeries={labelSeries}
          latestDataDate={latestDataDate}
          latestRunDate={latestRunDate}
          selectedCompetitorLabelKey={
            typeof settings?.competitor_label_key === "string" && settings.competitor_label_key.trim()
              ? settings.competitor_label_key.trim()
              : null
          }
          gainers={gainers}
          losers={losers}
          churn7d={churn7d}
          churn30d={churn30d}
          overlapCells={overlapCells}
          playlistsByLabel={playlistsByLabelRecord}
        />
      ) : null}
    </div>
  );
}
