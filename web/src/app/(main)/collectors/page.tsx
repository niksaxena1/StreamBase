import Link from "next/link";

import { supabaseServer } from "@/lib/supabase/server";
import { formatDateISO } from "@/lib/format";
import { RememberParamRedirect } from "@/components/dashboard/RememberParamRedirect";
import { cachedQueries, cachedQuery } from "@/lib/supabase/cache";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import {
  CollectorsClient,
  type CollectorSeriesPoint,
  type CollectorSummaryRow,
  type TopPlaylistRow,
} from "./CollectorsClient";

export const dynamic = "force-dynamic";

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

export default async function CollectorsPage({
  searchParams,
}: {
  searchParams?: Promise<{ collector?: string; range?: string; start?: string; end?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const sb = await supabaseServer();

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
    return (
      <RememberParamRedirect
        param="collector"
        storageKey="sb:last_collector"
        defaultValue="A"
        loadingTitle="Opening your last collector…"
        loadingSubtitle="If this is your first time, we’ll start with A."
      />
    );
  }

  const { data: latestRow } = await cachedQueries(
    {
      latest: async () =>
        await sb
          .from("playlist_daily_stats")
          .select("date")
          .order("date", { ascending: false })
          .limit(1)
          .maybeSingle(),
    },
    "collectors-latest",
    600,
  ).then((r) => r.latest);

  const latestDate = (latestRow as { date: string } | null)?.date ?? null;
  if (!latestDate) {
    return (
      <div className="sb-card p-4 text-sm" style={{ color: "var(--sb-muted)" }}>
        No playlist stats found yet.
      </div>
    );
  }

  const sparkStart = addDaysIso(latestDate, -13);
  // Use custom start date if provided, otherwise calculate from rangeDays
  const rangeStart = sp.start && sp.end
    ? sp.start
    : addDaysIso(latestDate, -(rangeDays - 1));
  // Use custom end date if provided, otherwise use latestDate
  const rangeEnd = sp.end && sp.start ? sp.end : latestDate;

  const results = await cachedQueries(
    {
      playlistRows: async () =>
        await sb
          .from("playlists")
          .select("playlist_key,display_name,collector")
          .in("collector", [...COLLECTORS]),

      compareToday: async () =>
        await sb
          .from("collector_daily_compare")
          .select(
            "collector,date,track_count,total_streams_cumulative,daily_streams_net,est_revenue_total,est_revenue_daily_net,daily_streams_delta_yday,daily_streams_delta_ma7,est_revenue_daily_delta_yday,est_revenue_daily_delta_ma7,track_count_delta_yday,track_count_delta_ma7",
          )
          .eq("date", latestDate),

      spark14: async () =>
        await sb
          .from("collector_daily_agg")
          .select("collector,date,track_count,daily_streams_net,est_revenue_daily_net")
          .gte("date", sparkStart)
          .lte("date", latestDate)
          .order("date", { ascending: false }),

      series: async () =>
        await sb
          .from("collector_daily_agg")
          .select(
            "date,track_count,total_streams_cumulative,daily_streams_net,est_revenue_total,est_revenue_daily_net",
          )
          .eq("collector", selectedCollector)
          .gte("date", rangeStart)
          .lte("date", rangeEnd)
          .order("date", { ascending: false }),
    },
    `collectors-${selectedCollector}-${rangeStart}-${rangeEnd}`,
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

  const seriesDesc = (results.series.data ?? []) as CollectorSeriesPoint[];

  const selectedPlaylists = playlists.filter(
    (p) => (p.collector ?? "").toUpperCase() === selectedCollector,
  );
  const selectedKeys = selectedPlaylists.map((p) => p.playlist_key);
  const nameByKey = new Map(selectedPlaylists.map((p) => [p.playlist_key, p.display_name]));

  const topPlaylists: TopPlaylistRow[] = selectedKeys.length
    ? await (async () => {
        const { data: topRows } = await cachedQuery(
          async () =>
            await sb
              .from("playlist_daily_stats")
              .select("playlist_key,est_revenue_daily_net,daily_streams_net,missing_streams_track_count")
              .eq("date", latestDate)
              .in("playlist_key", selectedKeys)
              .order("est_revenue_daily_net", { ascending: false })
              .limit(15),
          `collectors-top-${selectedCollector}-${latestDate}`,
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

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">Collectors</h1>
          <p className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
            Latest snapshot: <span className="font-mono">{formatDateISO(latestDate)}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="sb-ring flex items-center gap-0.5 rounded-full bg-white/70 p-0.5 text-[11px] dark:bg-white/10">
            {RANGE_CHOICES.map((d) => (
              <Link
                key={d}
                href={`?collector=${encodeURIComponent(selectedCollector)}&range=${d}`}
                className={[
                  "rounded-full px-2.5 py-1.5 font-medium transition",
                  rangeDays === d && !sp.start && !sp.end
                    ? "bg-black text-white shadow-sm dark:bg-white dark:text-black"
                    : "hover:bg-white/70 dark:hover:bg-white/10",
                ].join(" ")}
                style={rangeDays === d && !sp.start && !sp.end ? undefined : { color: "var(--sb-muted)" }}
              >
                {d}d
              </Link>
            ))}
          </div>
          <DateRangePicker latestDate={latestDate} currentRangeDays={rangeDays} />
        </div>
      </div>

      <CollectorsClient
        latestDate={latestDate}
        selectedCollector={selectedCollector}
        rangeDays={rangeDays}
        summary={summary}
        seriesDesc={seriesDesc as CollectorSeriesPoint[]}
        topPlaylists={normalizedTopPlaylists}
      />
    </div>
  );
}

