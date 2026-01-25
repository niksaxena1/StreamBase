import Link from "next/link";
import { Activity } from "lucide-react";

import { StatCard } from "@/components/StatCard";
import { DailyStreamsChart } from "@/components/charts/DailyStreamsChart";
import { GlassTable, TableRow, TableCell, EmptyState } from "@/components/ui/GlassTable";
import { SpotlightCard } from "@/components/ui/SpotlightCard";
import { AnimatedCounter } from "@/components/ui/AnimatedCounter";
import { formatDateISO, formatInt, formatUsd } from "@/lib/format";
import { supabaseServer } from "@/lib/supabase/server";

type PlaylistDailyStatsRow = {
  date: string;
  track_count: number | null;
  total_streams_cumulative: number | null;
  daily_streams_net: number | null;
  est_revenue_total?: number | null;
  est_revenue_daily_net?: number | null;
};

const STREAM_PAYOUT_USD = 0.002;

export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<{ scope?: string; range?: string; daily?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const scope = (sp.scope ?? "all_catalog").toLowerCase();
  const rangeDays = Math.max(7, Math.min(365, Number(sp.range ?? "30") || 30));

  const playlistKey =
    scope === "releases" ? "releases" : scope === "ext" ? "ext" : "all_catalog";

  const sb = await supabaseServer();

  const { data: latest, error: latestErr } = await sb
    .from("playlist_daily_stats")
    .select(
      "date,track_count,total_streams_cumulative,daily_streams_net,est_revenue_total,est_revenue_daily_net",
    )
    .eq("playlist_key", playlistKey)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: history, error: historyErr } = await sb
    .from("playlist_daily_stats")
    .select(
      "date,track_count,total_streams_cumulative,daily_streams_net,est_revenue_daily_net",
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
    value: Number(getDailyStreams(r) ?? 0),
  }));

  const roll7 = rollingSums((history as PlaylistDailyStatsRow[] | null) ?? [], 7);
  const roll30 = rollingSums((history as PlaylistDailyStatsRow[] | null) ?? [], 30);

  return (
    <div className="space-y-4">
      {/* Header Section */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
            {title}
          </h1>
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

          <Link 
            href="/health" 
            className="group flex items-center gap-2 rounded-full border border-black/10 bg-white/50 px-3 py-1.5 text-xs font-medium backdrop-blur-md transition hover:bg-white dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
          >
            <Activity className="h-3.5 w-3.5 text-lime-500" />
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

      {/* KPI Row */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
        <StatCard
          title="Daily Streams"
          value={
            <AnimatedCounter
              value={getDailyStreams(latest as PlaylistDailyStatsRow | null) ?? 0}
            />
          }
          subtitle={`${rangeDays}d view`}
          accent
          trend="up"
          trendData={chartData.map((d) => d.value).slice(0, 30).reverse()}
        />
        <StatCard
          title="Total Streams"
          value={<AnimatedCounter value={latest?.total_streams_cumulative ?? 0} />}
          subtitle="Lifetime"
          trendData={((history as PlaylistDailyStatsRow[] | null) ?? [])
            .map((r) => Number(r.total_streams_cumulative ?? 0))
            .slice(0, 30)
            .reverse()}
        />
        <StatCard
          title="Active Tracks"
          value={<AnimatedCounter value={latest?.track_count ?? 0} />}
          subtitle="Tracked"
          trendData={((history as PlaylistDailyStatsRow[] | null) ?? [])
            .map((r) => Number(r.track_count ?? 0))
            .slice(0, 30)
            .reverse()}
        />
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

      {/* Chart */}
      <SpotlightCard className="relative p-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="flex items-center gap-2">
            <Activity className="h-3.5 w-3.5 opacity-60" />
            <div className="text-xs font-medium uppercase tracking-wide opacity-70">
              Daily Streams
            </div>
          </div>
          <div className="text-[11px] opacity-60">
            Last updated <span className="font-mono">{formatDateISO(latest?.date)}</span>
          </div>
        </div>

        <div className="mt-2">
          <DailyStreamsChart data={chartData} valueLabel="Streams" heightPx={220} />
        </div>

        {/* Decorative background glow (subtle) */}
        <div
          className="pointer-events-none absolute -right-14 -top-14 h-40 w-40 rounded-full opacity-15 blur-3xl"
          style={{ background: "var(--sb-accent)" }}
        />
      </SpotlightCard>

      {/* Recent History Table */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold tracking-tight">Recent History</h2>
        <GlassTable headers={["Date", "Tracks", "Total Streams", "Daily"]}>
          {(history ?? []).map((r) => (
            <TableRow key={r.date}>
              <TableCell mono>{formatDateISO(r.date)}</TableCell>
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
        props.active ? "bg-black text-white" : "text-black/70 hover:bg-white/70",
      ].join(" ")}
    >
      {props.children}
    </Link>
  );
}
