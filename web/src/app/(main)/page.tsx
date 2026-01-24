import Link from "next/link";
import { Activity } from "lucide-react";

import { StatCard } from "@/components/StatCard";
import { DailyStreamsChart } from "@/components/charts/DailyStreamsChart";
import { GlassTable, TableRow, TableCell } from "@/components/ui/GlassTable";
import { SpotlightCard } from "@/components/ui/SpotlightCard";
import { formatDateISO, formatInt, formatUsd } from "@/lib/format";
import { supabaseServer } from "@/lib/supabase/server";

type PlaylistDailyStatsRow = {
  date: string;
  track_count: number | null;
  total_streams_cumulative: number | null;
  daily_streams_net: number | null;
  daily_streams_lfl: number | null;
  est_revenue_total?: number | null;
  est_revenue_daily_net?: number | null;
  est_revenue_daily_lfl?: number | null;
};

const STREAM_PAYOUT_USD = 0.002;

export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<{ scope?: string; range?: string; daily?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const scope = (sp.scope ?? "all_catalog").toLowerCase();
  const daily = (sp.daily ?? "net").toLowerCase();
  const rangeDays = Math.max(7, Math.min(365, Number(sp.range ?? "30") || 30));

  const playlistKey =
    scope === "releases" ? "releases" : scope === "ext" ? "ext" : "all_catalog";

  const sb = await supabaseServer();

  const { data: latest, error: latestErr } = await sb
    .from("playlist_daily_stats")
    .select(
      "date,track_count,total_streams_cumulative,daily_streams_net,daily_streams_lfl,est_revenue_total,est_revenue_daily_net,est_revenue_daily_lfl",
    )
    .eq("playlist_key", playlistKey)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: history, error: historyErr } = await sb
    .from("playlist_daily_stats")
    .select(
      "date,track_count,total_streams_cumulative,daily_streams_net,daily_streams_lfl,est_revenue_daily_net,est_revenue_daily_lfl",
    )
    .eq("playlist_key", playlistKey)
    .order("date", { ascending: false })
    .limit(rangeDays);

  const title =
    playlistKey === "releases"
      ? "Releases"
      : playlistKey === "ext"
        ? "ext"
        : "All Catalog";

  // Prepare chart data
  const chartData = ((history as PlaylistDailyStatsRow[] | null) ?? []).map((r) => ({
    date: r.date,
    value: Number(getDailyStreams(r, daily) ?? 0),
  }));

  const roll7 = rollingSums((history as PlaylistDailyStatsRow[] | null) ?? [], daily, 7);
  const roll30 = rollingSums((history as PlaylistDailyStatsRow[] | null) ?? [], daily, 30);

  return (
    <div className="space-y-8">
      {/* Header Section */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight">{title}</h1>
          <p className="mt-2 text-base" style={{ color: "var(--sb-muted)" }}>
            Overview of your catalog performance across all playlists.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="sb-ring flex items-center gap-1 rounded-full bg-white/60 p-1">
            <ToggleLink active={playlistKey === "all_catalog"} href={hrefWith(sp, { scope: "all_catalog" })}>All Catalog</ToggleLink>
            <ToggleLink active={playlistKey === "releases"} href={hrefWith(sp, { scope: "releases" })}>Releases</ToggleLink>
            <ToggleLink active={playlistKey === "ext"} href={hrefWith(sp, { scope: "ext" })}>ext</ToggleLink>
          </div>

          <div className="sb-ring flex items-center gap-1 rounded-full bg-white/60 p-1">
            <ToggleLink active={rangeDays === 30} href={hrefWith(sp, { range: "30" })}>30d</ToggleLink>
            <ToggleLink active={rangeDays === 90} href={hrefWith(sp, { range: "90" })}>90d</ToggleLink>
            <ToggleLink active={rangeDays === 365} href={hrefWith(sp, { range: "365" })}>365d</ToggleLink>
          </div>

          <div className="sb-ring flex items-center gap-1 rounded-full bg-white/60 p-1">
            <ToggleLink active={daily !== "lfl"} href={hrefWith(sp, { daily: "net" })}>Net</ToggleLink>
            <ToggleLink active={daily === "lfl"} href={hrefWith(sp, { daily: "lfl" })}>LFL</ToggleLink>
          </div>

          <Link 
            href="/health" 
            className="group flex items-center gap-2 rounded-full border border-black/10 bg-white/50 px-4 py-2 text-sm font-medium backdrop-blur-md transition hover:bg-white dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
          >
            <Activity className="h-4 w-4 text-lime-500" />
            System Health
          </Link>
        </div>
      </div>

      {(latestErr || historyErr) && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-950 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-200">
          Query error:{" "}
          {latestErr?.message ?? historyErr?.message ?? "unknown error"}
        </div>
      )}

      {/* Bento Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4 lg:grid-rows-3">
        
        {/* Main Chart Card - Spans 2 cols, 2 rows (Big Feature) */}
        <SpotlightCard className="col-span-1 flex flex-col justify-between p-6 lg:col-span-2 lg:row-span-2">
          <div className="relative z-10">
            <div className="flex items-center gap-2 text-sm font-medium uppercase tracking-wider opacity-60">
              <Activity className="h-4 w-4" />
              Daily Streams ({daily === "lfl" ? "LFL" : "Net"})
            </div>
            <div className="mt-2 font-display text-5xl font-semibold tracking-tight">
              {formatInt(getDailyStreams(latest as PlaylistDailyStatsRow | null, daily))}
            </div>
            <div className="mt-1 text-sm opacity-60">{rangeDays} day view</div>
          </div>
          
          <div className="mt-8 h-full min-h-[200px] w-full">
             <DailyStreamsChart data={chartData} valueLabel="Streams" />
          </div>

          {/* Decorative background glow for main card */}
          <div 
            className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full opacity-20 blur-3xl"
            style={{ background: "var(--sb-accent)" }}
          />
        </SpotlightCard>

        {/* Stat Cards */}
        <StatCard
          title="Total Streams"
          value={formatInt(latest?.total_streams_cumulative)}
          subtitle="Lifetime cumulative"
          accent
          trend="up"
        />
        
        <StatCard
          title="Active Tracks"
          value={formatInt(latest?.track_count)}
          subtitle="Currently tracked"
        />

        <StatCard
          title="Est. Revenue"
          value={formatUsd(getRevenueDaily(latest as PlaylistDailyStatsRow | null, daily))}
          subtitle={`Daily (${daily === "lfl" ? "LFL" : "Net"})`}
        />

        <StatCard
          title={`Last 7d Streams (${daily === "lfl" ? "LFL" : "Net"})`}
          value={
            roll7.hasData ? formatInt(roll7.streamsSum) : "—"
          }
          subtitle={
            roll7.hasData
              ? `${formatUsd(roll7.revenueSum)} est. revenue`
              : "Need at least 2 days of history"
          }
        />

        <StatCard
          title={`Last 30d Streams (${daily === "lfl" ? "LFL" : "Net"})`}
          value={
            roll30.hasData ? formatInt(roll30.streamsSum) : "—"
          }
          subtitle={
            roll30.hasData
              ? `${formatUsd(roll30.revenueSum)} est. revenue`
              : "Need at least 2 days of history"
          }
        />

        <div className="sb-card flex flex-col justify-center rounded-[28px] p-6">
           <div className="text-sm font-medium opacity-60">Last Updated</div>
           <div className="mt-1 font-mono text-lg">
             {formatDateISO(latest?.date)}
           </div>
           <div className="mt-4 text-xs opacity-50">
             Data ingested daily via SpotOnTrack exports.
           </div>
        </div>
      </div>

      {/* Recent History Table */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">Recent History</h2>
        <GlassTable headers={["Date", "Tracks", "Total Streams", "Daily (Net)", "Daily (LFL)"]}>
          {(history ?? []).map((r) => (
            <TableRow key={r.date}>
              <TableCell mono>{formatDateISO(r.date)}</TableCell>
              <TableCell>{formatInt(r.track_count)}</TableCell>
              <TableCell>{formatInt(r.total_streams_cumulative)}</TableCell>
              <TableCell className="text-lime-700 dark:text-lime-400 font-medium">
                +{formatInt(r.daily_streams_net)}
              </TableCell>
              <TableCell>{formatInt(r.daily_streams_lfl)}</TableCell>
            </TableRow>
          ))}
          {!history?.length && (
            <TableRow>
              <TableCell className="text-center opacity-50 py-8" colSpan={5}>
                No stats found.
              </TableCell>
            </TableRow>
          )}
        </GlassTable>
      </div>
    </div>
  );
}

function getDailyStreams(
  row: PlaylistDailyStatsRow | null,
  mode: string,
): number | null {
  if (!row) return null;
  return mode === "lfl" ? row.daily_streams_lfl : row.daily_streams_net;
}

function getRevenueDaily(
  row: PlaylistDailyStatsRow | null,
  mode: string,
): number | null {
  if (!row) return null;
  return mode === "lfl"
    ? row.est_revenue_daily_lfl ?? null
    : row.est_revenue_daily_net ?? null;
}

function rollingSums(
  rowsDesc: PlaylistDailyStatsRow[],
  mode: string,
  days: number,
): { hasData: boolean; streamsSum: number; revenueSum: number; countedDays: number } {
  const slice = rowsDesc.slice(0, days);
  let streamsSum = 0;
  let revenueSum = 0;
  let countedDays = 0;

  for (const r of slice) {
    const ds = getDailyStreams(r, mode);
    if (ds === null || !Number.isFinite(ds)) continue;
    streamsSum += Number(ds);
    countedDays += 1;

    const rev =
      getRevenueDaily(r, mode) ??
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
  const daily = (patch.daily ?? existing.daily ?? "net").toString();
  u.searchParams.set("scope", scope);
  u.searchParams.set("range", range);
  u.searchParams.set("daily", daily);
  return `${u.pathname}?${u.searchParams.toString()}`;
}

function ToggleLink(props: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={props.href}
      className={[
        "rounded-full px-3 py-2 text-xs font-medium transition",
        props.active ? "bg-black text-white" : "text-black/70 hover:bg-white/70",
      ].join(" ")}
    >
      {props.children}
    </Link>
  );
}
