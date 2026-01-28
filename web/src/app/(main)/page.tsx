import Link from "next/link";

import { StatCard } from "@/components/StatCard";
import { GlassTable, TableRow, TableCell, EmptyState } from "@/components/ui/GlassTable";
import { AnimatedCounter } from "@/components/ui/AnimatedCounter";
import { LazyInteractiveChartSection } from "@/components/dashboard/LazyInteractiveChartSection";
import { formatDateISO, formatInt, formatUsd } from "@/lib/format";
import { supabaseServer } from "@/lib/supabase/server";
import { cachedQuery } from "@/lib/supabase/cache";
import { dataDateFromRunDate } from "@/lib/sotDates";

type PlaylistDailyStatsRow = {
  date: string;
  track_count: number | null;
  total_streams_cumulative: number | null;
  daily_streams_net: number | null;
  est_revenue_total?: number | null;
  est_revenue_daily_net?: number | null;
};

const STREAM_PAYOUT_USD = 0.002;

// Revalidate every hour since data updates daily
export const revalidate = 3600;

export default async function Home({
  searchParams,
}: {
  // See note in other pages: keep this as `any` to satisfy Next's generated PageProps typing
  // while avoiding `await searchParams` (which breaks static generation in Next 16).
  searchParams?: any;
}) {
  const sp = (searchParams ?? {}) as { scope?: string; range?: string; daily?: string };
  const scope = (sp.scope ?? "all_catalog").toLowerCase();
  const rangeDays = Math.max(7, Math.min(365, Number(sp.range ?? "30") || 30));

  const playlistKey =
    scope === "releases" ? "releases" : scope === "ext" ? "ext" : "all_catalog";

  const sb = await supabaseServer();

  // Single query: fetch history and derive latest from first row (cached for 1 hour)
  const { data: history, error: historyErr } = await cachedQuery(
    async () =>
      await sb
        .from("playlist_daily_stats")
        .select(
          "date,track_count,total_streams_cumulative,daily_streams_net,est_revenue_total,est_revenue_daily_net",
        )
        .eq("playlist_key", playlistKey)
        .order("date", { ascending: false })
        .limit(rangeDays),
    `home-playlist-stats-${playlistKey}-${rangeDays}`,
    3600, // 1 hour
  );

  // Derive latest from first row of history (newest date)
  const latest = history && history.length > 0 ? history[0] : null;

  const title =
    playlistKey === "releases"
      ? "Releases"
      : playlistKey === "ext"
        ? "ext"
        : "All Catalog";

  // Prepare chart data for all three chart types
  const dailyStreamsRaw = ((history as PlaylistDailyStatsRow[] | null) ?? []).map((r) => ({
    date: r.date,
    daily: Number(getDailyStreams(r) ?? 0),
  }));
  
  // Calculate 7-day moving average for daily streams
  const dailyStreamsWithMA = computeRollingAvg7(dailyStreamsRaw);
  const dailyStreamsChartData = dailyStreamsWithMA.map((r) => ({
    date: dataDateFromRunDate(r.date),
    value: r.daily,
    ma7: r.ma7,
  }));

  const totalStreamsChartData = ((history as PlaylistDailyStatsRow[] | null) ?? []).map((r) => ({
    date: dataDateFromRunDate(r.date),
    value: Number(r.total_streams_cumulative ?? 0),
  }));

  const activeTracksChartData = ((history as PlaylistDailyStatsRow[] | null) ?? []).map((r) => ({
    date: dataDateFromRunDate(r.date),
    value: Number(r.track_count ?? 0),
  }));

  const roll7 = rollingSums((history as PlaylistDailyStatsRow[] | null) ?? [], 7);
  const roll30 = rollingSums((history as PlaylistDailyStatsRow[] | null) ?? [], 30);

  return (
    <div className="space-y-4">
      {/* Header Section */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
              {title}
            </h1>
            {latest?.track_count !== null && latest?.track_count !== undefined && (
              <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-wide" style={{ 
                borderColor: "var(--sb-border)",
                backgroundColor: "var(--sb-surface)",
                color: "var(--sb-muted)"
              }}>
                {formatInt(latest.track_count)} tracks
              </span>
            )}
          </div>
          <p className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
            Overview of your catalog performance across all playlists.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="sb-ring flex items-center gap-0.5 rounded-full bg-white/60 p-0.5">
            <ToggleLink
              active={playlistKey === "all_catalog"}
              href={hrefWith(sp, { scope: "all_catalog" })}
            >
              All
            </ToggleLink>
            <ToggleLink
              active={playlistKey === "releases"}
              href={hrefWith(sp, { scope: "releases" })}
            >
              Releases
            </ToggleLink>
            <ToggleLink
              active={playlistKey === "ext"}
              href={hrefWith(sp, { scope: "ext" })}
            >
              Ext
            </ToggleLink>
          </div>

          <div className="sb-ring flex items-center gap-0.5 rounded-full bg-white/60 p-0.5">
            <ToggleLink
              active={rangeDays === 30}
              href={hrefWith(sp, { range: "30" })}
            >
              30d
            </ToggleLink>
            <ToggleLink
              active={rangeDays === 90}
              href={hrefWith(sp, { range: "90" })}
            >
              90d
            </ToggleLink>
            <ToggleLink
              active={rangeDays === 365}
              href={hrefWith(sp, { range: "365" })}
            >
              365d
            </ToggleLink>
          </div>
        </div>
      </div>

      {historyErr && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-950 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-200">
          Query error: {historyErr.message ?? "unknown error"}
        </div>
      )}

      {/* Interactive KPI Row and Chart */}
      <LazyInteractiveChartSection
        dailyStreamsData={dailyStreamsChartData}
        totalStreamsData={totalStreamsChartData}
        dailyStreamsValue={getDailyStreams(latest as PlaylistDailyStatsRow | null) ?? 0}
        totalStreamsValue={latest?.total_streams_cumulative ?? 0}
        rangeDays={rangeDays}
        latestDate={latest?.date ? dataDateFromRunDate(latest.date) : null}
      />

      {/* Additional Stat Cards */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
        <StatCard
          title="Revenue (Daily)"
          value={formatUsd(getRevenueDaily(latest as PlaylistDailyStatsRow | null))}
          subtitle="Est."
          trendData={((history as PlaylistDailyStatsRow[] | null) ?? [])
            .map((r) => Number(getRevenueDaily(r) ?? 0))
            .slice(0, 30)
            .reverse()}
        />
        <StatCard
          title="Streams (7d)"
          value={roll7.hasData ? <AnimatedCounter value={roll7.streamsSum} /> : "—"}
          subtitle={roll7.hasData ? formatUsd(roll7.revenueSum) : "Need 2+ days"}
        />
        <StatCard
          title="Streams (30d)"
          value={roll30.hasData ? <AnimatedCounter value={roll30.streamsSum} /> : "—"}
          subtitle={roll30.hasData ? formatUsd(roll30.revenueSum) : "Need 2+ days"}
        />
      </div>

      {/* Recent History Table */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold tracking-tight">Recent History</h2>
        <GlassTable headers={["Date", "Tracks", "Total Streams", "Daily"]}>
          {(history ?? []).map((r) => (
            <TableRow key={r.date}>
              <TableCell mono>{formatDateISO(dataDateFromRunDate(r.date))}</TableCell>
              <TableCell>{formatInt(r.track_count)}</TableCell>
              <TableCell>{formatInt(r.total_streams_cumulative)}</TableCell>
              <TableCell className="text-lime-700 dark:text-lime-400 font-medium">
                +{formatInt(r.daily_streams_net)}
              </TableCell>
            </TableRow>
          ))}
          {!history?.length && (
            <EmptyState colSpan={4} message="No stats found yet" />
          )}
        </GlassTable>
      </div>
    </div>
  );
}

function getDailyStreams(
  row: PlaylistDailyStatsRow | null,
): number | null {
  if (!row) return null;
  return row.daily_streams_net;
}

function computeRollingAvg7(desc: Array<{ date: string; daily: number }>) {
  // Input: newest-first. Output: newest-first with ma7.
  const asc = [...desc].reverse();
  const outAsc: Array<{ date: string; daily: number; ma7: number | null }> = [];

  for (let i = 0; i < asc.length; i++) {
    const start = Math.max(0, i - 6);
    const window = asc.slice(start, i + 1).map((p) => Number(p.daily ?? 0));
    const has7 = window.length >= 7;
    const avg = window.reduce((a, b) => a + b, 0) / window.length;
    outAsc.push({ date: asc[i].date, daily: asc[i].daily, ma7: has7 ? avg : null });
  }

  return outAsc.reverse();
}

function getRevenueDaily(
  row: PlaylistDailyStatsRow | null,
): number | null {
  if (!row) return null;
  return row.est_revenue_daily_net ?? null;
}

function rollingSums(
  rowsDesc: PlaylistDailyStatsRow[],
  days: number,
): { hasData: boolean; streamsSum: number; revenueSum: number; countedDays: number } {
  const slice = rowsDesc.slice(0, days);
  let streamsSum = 0;
  let revenueSum = 0;
  let countedDays = 0;

  for (const r of slice) {
    const ds = getDailyStreams(r);
    if (ds === null || !Number.isFinite(ds)) continue;
    streamsSum += Number(ds);
    countedDays += 1;

    const rev =
      getRevenueDaily(r) ??
      (Number.isFinite(ds) ? Number(ds) * STREAM_PAYOUT_USD : null);
    if (rev !== null && Number.isFinite(rev)) revenueSum += Number(rev);
  }

  // Require at least 2 daily points to avoid showing sums on day 1.
  return { hasData: countedDays >= 2, streamsSum, revenueSum, countedDays };
}

function hrefWith(
  existing: { scope?: string; range?: string; daily?: string },
  patch: { scope?: string; range?: string; daily?: string },
) {
  const u = new URL("https://example.com/");
  const scope = (patch.scope ?? existing.scope ?? "all_catalog").toString();
  const range = (patch.range ?? existing.range ?? "30").toString();
  u.searchParams.set("scope", scope);
  u.searchParams.set("range", range);
  return `${u.pathname}?${u.searchParams.toString()}`;
}

function ToggleLink(props: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={props.href}
      className={[
        "rounded-full px-2.5 py-1.5 text-[11px] font-medium transition",
        props.active ? "bg-black text-white dark:bg-white dark:text-black" : "text-black/70 hover:bg-white/70 dark:text-white/70 dark:hover:bg-white/20",
      ].join(" ")}
    >
      {props.children}
    </Link>
  );
}
