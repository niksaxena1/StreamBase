import Link from "next/link";
import { redirect } from "next/navigation";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { formatDateISO } from "@/lib/format";
import { RememberParamRedirect } from "@/components/dashboard/RememberParamRedirect";
import { cachedQueries, cachedQuery } from "@/lib/supabase/cache";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { dataDateFromRunDate, SOT_DATA_LAG_DAYS, addDaysISO } from "@/lib/sotDates";
import {
  CollectorsClient,
  type CollectorSeriesPoint,
  type CollectorSummaryRow,
  type TopPlaylistRow,
} from "./CollectorsClient";
import { CollectorsPageHeader } from "./CollectorsPageHeader";

export const revalidate = 86400; // 24h ISR - data updates daily

const COLLECTORS = ["A", "K", "N", "PL", "TG", "NL"] as const;
type CollectorKey = (typeof COLLECTORS)[number];

const RANGE_CHOICES = [30, 90, 365] as const;

function clampRangeDays(x: unknown) {
  const n = Number(x ?? "90") || 90;
  return Math.max(7, Math.min(365, n));
}

function addDaysIso(dateIso: string, deltaDays: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

type PlaylistRow = {
  playlist_key: string;
  display_name: string;
  collector: string | null;
};

type CollectorTrackRow = {
  isrc: string;
  name: string | null;
  album_image_url: string | null;
  artist_names: string[] | null;
  artist_ids: string[] | null;
  playlist_keys: string[] | null;
  distro_playlist_keys: string[] | null;
  total_streams_cumulative: number | null;
  daily_streams_delta: number | null;
};

export default async function CollectorsPage({
  searchParams,
}: {
  // See note in other pages: keep this as `any` to satisfy Next's generated PageProps typing
  // while avoiding `await searchParams` (which breaks static generation in Next 16).
  searchParams?: any;
}) {
  const sp = (await searchParams ?? {}) as { collector?: string; range?: string; start?: string; end?: string };
  const sb = await supabaseServer();
  const { data: userData } = await sb.auth.getUser();
  if (!userData.user) redirect("/login");

  const { data: isAdmin } = await sb.rpc("is_admin");
  if (!isAdmin) redirect("/");

  // IMPORTANT: These tables are protected by admin-only RLS. Use the service-role client
  // for cached reads; access is still gated above.
  const svc = supabaseService();

  // If custom start/end dates are provided, calculate range from them
  let rangeDays = clampRangeDays(sp.range);
  if (sp.start && sp.end) {
    const start = new Date(`${sp.start}T00:00:00Z`);
    const end = new Date(`${sp.end}T00:00:00Z`);
    const calculatedDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    rangeDays = Math.max(7, Math.min(365, calculatedDays));
  }
  const rawCollector = (sp.collector ?? "").trim().toUpperCase();
  const selectedCollector = (COLLECTORS as readonly string[]).includes(rawCollector)
    ? (rawCollector as CollectorKey)
    : null;

  if (!selectedCollector) {
    // Fetch latest data to find the collector with highest streams
    const { data: latestRowForDefault } = await cachedQueries(
      {
        latest: async () =>
          await svc
            .from("playlist_daily_stats")
            .select("date")
            .order("date", { ascending: false })
            .limit(1)
            .maybeSingle(),
      },
      "collectors-latest-for-default",
      600,
    ).then((r) => r.latest);

    const latestRunDateForDefault = (latestRowForDefault as { date: string } | null)?.date ?? null;

    if (latestRunDateForDefault) {
      const { data: compareRowsForDefault } = await cachedQuery(
        async () =>
          await svc
            .from("collector_daily_compare")
            .select("collector,daily_streams_net")
            .eq("date", latestRunDateForDefault),
        `collectors-compare-for-default-${latestRunDateForDefault}`,
        600,
      );

      const rows = (compareRowsForDefault ?? []) as Array<{ collector: string; daily_streams_net: number }>;
      if (rows.length > 0) {
        // Find collector with highest streams
        const highestCollector = rows.reduce((max, current) => {
          const currentStreams = Number(current.daily_streams_net ?? 0);
          const maxStreams = Number(max.daily_streams_net ?? 0);
          return currentStreams > maxStreams ? current : max;
        });

        const defaultCollector = String(highestCollector.collector ?? "").toUpperCase();
        if ((COLLECTORS as readonly string[]).includes(defaultCollector)) {
          return (
            <RememberParamRedirect
              param="collector"
              storageKey="sb:last_collector"
              defaultValue={defaultCollector}
              loadingTitle="Opening collector with highest streams…"
              loadingSubtitle="Redirecting to your default collector."
            />
          );
        }
      }
    }

    // Fallback to RememberParamRedirect with default "A"
    return (
      <RememberParamRedirect
        param="collector"
        storageKey="sb:last_collector"
        defaultValue="A"
        loadingTitle="Opening your last collector…"
        loadingSubtitle="If this is your first time, we'll start with A."
      />
    );
  }

  const { data: latestRow } = await cachedQueries(
    {
      latest: async () =>
        await svc
          .from("playlist_daily_stats")
          .select("date")
          .order("date", { ascending: false })
          .limit(1)
          .maybeSingle(),
    },
    "collectors-latest",
    600,
  ).then((r) => r.latest);

  const latestRunDate = (latestRow as { date: string } | null)?.date ?? null;
  const latestDataDate = latestRunDate ? dataDateFromRunDate(latestRunDate) : null;
  if (!latestRunDate) {
    return (
      <div className="sb-card p-4 text-sm" style={{ color: "var(--sb-muted)" }}>
        No playlist stats found yet.
      </div>
    );
  }

  const sparkStart = latestRunDate ? addDaysIso(latestRunDate, -13) : null;
  const prevRunDate = latestRunDate ? addDaysIso(latestRunDate, -1) : null;
  // Use custom start date if provided, otherwise calculate from rangeDays
  const rangeStart = sp.start && sp.end
    ? addDaysISO(sp.start, SOT_DATA_LAG_DAYS) // data date -> run date
    : latestRunDate
      ? addDaysIso(latestRunDate, -(rangeDays - 1))
      : null;
  // Use custom end date if provided, otherwise use latestRunDate
  const rangeEnd = sp.end && sp.start ? addDaysISO(sp.end, SOT_DATA_LAG_DAYS) : latestRunDate;

  const results = await cachedQueries(
    {
      playlistRows: async () =>
        await svc
          .from("playlists")
          .select("playlist_key,display_name,collector")
          .in("collector", [...COLLECTORS]),

      compareToday: async () =>
        await svc
          .from("collector_daily_compare")
          .select(
            "collector,date,track_count,total_streams_cumulative,daily_streams_net,est_revenue_total,est_revenue_daily_net,daily_streams_delta_yday,daily_streams_delta_ma7,est_revenue_daily_delta_yday,est_revenue_daily_delta_ma7,track_count_delta_yday,track_count_delta_ma7",
          )
          .eq("date", latestRunDate),

      spark14: async () =>
        await svc
          .from("collector_daily_agg")
          .select("collector,date,track_count,daily_streams_net,est_revenue_daily_net")
          .gte("date", sparkStart!)
          .lte("date", latestRunDate!)
          .order("date", { ascending: false }),

      series: async () =>
        await svc
          .from("collector_daily_agg")
          .select(
            "date,track_count,total_streams_cumulative,daily_streams_net,est_revenue_total,est_revenue_daily_net",
          )
          .eq("collector", selectedCollector)
          .gte("date", rangeStart!)
          .lte("date", rangeEnd!)
          .order("date", { ascending: false }),

      // Fetch all collectors data for comparison chart (date-range filtered for daily view)
      allCollectorsSeries: async () =>
        await svc
          .from("collector_daily_agg")
          .select(
            "collector,date,track_count,daily_streams_net,est_revenue_daily_net",
          )
          .gte("date", rangeStart!)
          .lte("date", rangeEnd!)
          .order("date", { ascending: true }),

      // Fetch ALL-TIME data for non-daily granularities (weekly/monthly/quarterly/yearly)
      allCollectorsAllTime: async () =>
        await svc
          .from("collector_daily_agg")
          .select(
            "collector,date,track_count,daily_streams_net,est_revenue_daily_net",
          )
          .order("date", { ascending: true }),

      collectorTracks: async () =>
        await svc.rpc("collector_tracks", {
          collector: selectedCollector,
          run_date: latestRunDate,
          prev_date: prevRunDate,
          limit_rows: 5000,
        }),
    },
    `collectors-${selectedCollector}-${rangeStart}-${rangeEnd}-${latestRunDate}`,
    600,
  );

  const playlists = (results.playlistRows.data ?? []) as PlaylistRow[];
  const playlistCountByCollector = new Map<string, number>();
  for (const c of COLLECTORS) playlistCountByCollector.set(c, 0);
  for (const p of playlists) {
    const c = (p.collector ?? "").toUpperCase();
    if (!playlistCountByCollector.has(c)) continue;
    playlistCountByCollector.set(c, (playlistCountByCollector.get(c) ?? 0) + 1);
  }

  const compareRows = (results.compareToday.data ?? []) as any[];
  const sparkRows = (results.spark14.data ?? []) as any[];

  const sparkByCollector = new Map<string, { rev: number[]; streams: number[]; tracks: number[] }>();
  for (const c of COLLECTORS) sparkByCollector.set(c, { rev: [], streams: [], tracks: [] });
  for (const r of sparkRows) {
    const c = String(r.collector ?? "").toUpperCase();
    const cur = sparkByCollector.get(c);
    if (!cur) continue;
    cur.rev.push(Number(r.est_revenue_daily_net ?? 0));
    cur.streams.push(Number(r.daily_streams_net ?? 0));
    cur.tracks.push(Number(r.track_count ?? 0));
  }

  const summary: CollectorSummaryRow[] = COLLECTORS.map((c) => {
    const row = compareRows.find((r) => String(r.collector ?? "").toUpperCase() === c) ?? {};
    const spark = sparkByCollector.get(c)!;
    return {
      collector: c,
      playlists: playlistCountByCollector.get(c) ?? 0,
      track_count: Number(row.track_count ?? 0),
      total_streams_cumulative: Number(row.total_streams_cumulative ?? 0),
      daily_streams_net: Number(row.daily_streams_net ?? 0),
      est_revenue_total: Number(row.est_revenue_total ?? 0),
      est_revenue_daily_net: Number(row.est_revenue_daily_net ?? 0),
      daily_streams_delta_yday: row.daily_streams_delta_yday == null ? null : Number(row.daily_streams_delta_yday),
      daily_streams_delta_ma7: row.daily_streams_delta_ma7 == null ? null : Number(row.daily_streams_delta_ma7),
      est_revenue_daily_delta_yday:
        row.est_revenue_daily_delta_yday == null ? null : Number(row.est_revenue_daily_delta_yday),
      est_revenue_daily_delta_ma7:
        row.est_revenue_daily_delta_ma7 == null ? null : Number(row.est_revenue_daily_delta_ma7),
      track_count_delta_yday: row.track_count_delta_yday == null ? null : Number(row.track_count_delta_yday),
      track_count_delta_ma7: row.track_count_delta_ma7 == null ? null : Number(row.track_count_delta_ma7),
      spark_rev_daily: spark.rev,
      spark_streams_daily: spark.streams,
      spark_tracks: spark.tracks,
    };
  });

  const seriesDescRun = (results.series.data ?? []) as CollectorSeriesPoint[];
  const seriesDesc = seriesDescRun.map((p) => ({
    ...p,
    date: dataDateFromRunDate(p.date),
  }));

  // Process all collectors data for comparison chart (date-range filtered)
  const allCollectorsRaw = (results.allCollectorsSeries.data ?? []) as Array<{
    collector: string;
    date: string;
    track_count: number;
    daily_streams_net: number;
    est_revenue_daily_net: number;
  }>;
  const allCollectorsSeries = allCollectorsRaw.map((p) => ({
    ...p,
    date: dataDateFromRunDate(p.date),
  }));

  // Process all-time data for non-daily granularities
  const allCollectorsAllTimeRaw = (results.allCollectorsAllTime.data ?? []) as Array<{
    collector: string;
    date: string;
    track_count: number;
    daily_streams_net: number;
    est_revenue_daily_net: number;
  }>;
  const allCollectorsAllTime = allCollectorsAllTimeRaw.map((p) => ({
    ...p,
    date: dataDateFromRunDate(p.date),
  }));

  const selectedPlaylists = playlists.filter(
    (p) => (p.collector ?? "").toUpperCase() === selectedCollector,
  );
  const selectedKeys = selectedPlaylists.map((p) => p.playlist_key);
  const nameByKey = new Map(selectedPlaylists.map((p) => [p.playlist_key, p.display_name]));

  const topPlaylists: TopPlaylistRow[] = selectedKeys.length
    ? await (async () => {
        const { data: topRows } = await cachedQuery(
          async () =>
            await svc
              .from("playlist_daily_stats")
              .select("playlist_key,est_revenue_daily_net,daily_streams_net,missing_streams_track_count")
          .eq("date", latestRunDate)
              .in("playlist_key", selectedKeys)
              .order("est_revenue_daily_net", { ascending: false })
              .limit(15),
          `collectors-top-${selectedCollector}-${latestRunDate}`,
          600,
        );

        return ((topRows ?? []) as any[]).map((r) => ({
          playlist_key: String(r.playlist_key),
          display_name: String(nameByKey.get(String(r.playlist_key)) ?? r.playlist_key),
          est_revenue_daily_net: r.est_revenue_daily_net == null ? null : Number(r.est_revenue_daily_net),
          daily_streams_net: r.daily_streams_net == null ? null : Number(r.daily_streams_net),
          missing_streams_track_count: r.missing_streams_track_count == null ? null : Number(r.missing_streams_track_count),
        }));
      })()
    : [];

  // Normalize display names for safety even if we skipped the query
  const normalizedTopPlaylists: TopPlaylistRow[] = topPlaylists.map((r) => ({
    playlist_key: String(r.playlist_key),
    display_name: String(nameByKey.get(String(r.playlist_key)) ?? r.display_name ?? r.playlist_key),
    est_revenue_daily_net: r.est_revenue_daily_net,
    daily_streams_net: r.daily_streams_net,
    missing_streams_track_count: r.missing_streams_track_count,
  }));

  const collectorTracks = ((results.collectorTracks.data ?? []) as any[]).map((r): CollectorTrackRow => ({
    isrc: String(r.isrc),
    name: r.name == null ? null : String(r.name),
    album_image_url: r.album_image_url == null ? null : String(r.album_image_url),
    artist_names: (r.artist_names ?? null) as string[] | null,
    artist_ids: (r.artist_ids ?? null) as string[] | null,
    playlist_keys: (r.playlist_keys ?? null) as string[] | null,
    distro_playlist_keys: (r.distro_playlist_keys ?? null) as string[] | null,
    total_streams_cumulative: r.total_streams_cumulative == null ? null : Number(r.total_streams_cumulative),
    daily_streams_delta: r.daily_streams_delta == null ? null : Number(r.daily_streams_delta),
  }));

  return (
    <div className="space-y-4">
      <CollectorsPageHeader
        selectedCollector={selectedCollector}
        rangeDays={rangeDays}
        latestDataDate={latestDataDate}
      />

      <CollectorsClient
        latestDate={latestDataDate}
        selectedCollector={selectedCollector}
        rangeDays={rangeDays}
        summary={summary}
        seriesDesc={seriesDesc as CollectorSeriesPoint[]}
        topPlaylists={normalizedTopPlaylists}
        collectorTracks={collectorTracks}
        allCollectorsSeries={allCollectorsSeries}
        allCollectorsAllTime={allCollectorsAllTime}
      />
    </div>
  );
}

