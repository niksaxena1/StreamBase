"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import { Download, Music, Search, X } from "lucide-react";

import { MetricProvider, useMetric } from "@/components/metrics/MetricContext";
import { MetricSelector } from "@/components/metrics/MetricSelector";
import { LazyInteractiveChartSection } from "@/components/dashboard/LazyInteractiveChartSection";
import { StatCard } from "@/components/StatCard";
import { AnimatedCounter } from "@/components/ui/AnimatedCounter";
import { GlassTable, TableRow, TableCell, EmptyState } from "@/components/ui/GlassTable";
import { formatDateISO, formatInt, formatUsd } from "@/lib/format";
import { dataDateFromRunDate } from "@/lib/sotDates";
import { Alert } from "@/components/ui/Alert";
import { hrefWithPatchedSearchParams } from "@/lib/searchParams";
import { usePayoutRate } from "@/components/payout/PayoutRateContext";
import { TrackStreamsXYChart, type TrackStreamsXYPoint } from "@/components/charts/TrackStreamsXYChart";
import { ArtistStreamsXYChart, aggregateTracksToArtists } from "@/components/charts/ArtistStreamsXYChart";
import { DatePicker } from "@/components/ui/DatePicker";
import { foldForSearch } from "@/lib/searchFold";

type PlaylistDailyStatsRow = {
  date: string;
  track_count: number | null;
  total_streams_cumulative: number | null;
  daily_streams_net: number | null;
  est_revenue_total?: number | null;
  est_revenue_daily_net?: number | null;
};

type ChartPoint = { date: string; value: number; ma7?: number | null };

function computeRollingAvg7(desc: Array<{ date: string; value: number }>) {
  const asc = [...desc].reverse();
  const outAsc: Array<{ date: string; value: number; ma7: number | null }> = [];
  for (let i = 0; i < asc.length; i++) {
    const start = Math.max(0, i - 6);
    const window = asc.slice(start, i + 1).map((p) => Number(p.value ?? 0));
    const avg = window.reduce((a, b) => a + b, 0) / window.length;
    outAsc.push({ date: asc[i].date, value: asc[i].value, ma7: avg });
  }
  return outAsc.reverse();
}

function hrefWith(
  existing: { scope?: string; range?: string; daily?: string; xy_date?: string },
  patch: { scope?: string; range?: string; daily?: string; xy_date?: string | null },
) {
  const scope = (patch.scope ?? existing.scope ?? "all_catalog").toString();
  const range = (patch.range ?? existing.range ?? "30").toString();
  const daily = (patch.daily ?? existing.daily ?? "").toString();
  const xy_date =
    patch.xy_date === null ? null : (patch.xy_date ?? existing.xy_date ?? null);
  return hrefWithPatchedSearchParams("", { scope, range, daily, xy_date }, { prefix: "/?" });
}

function ToggleLink(props: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={props.href}
      className={[
        "rounded-full px-2.5 py-1.5 text-[11px] font-medium transition",
        props.active
          ? "bg-black text-white dark:bg-white dark:text-black"
          : "text-black/70 hover:bg-white/70 dark:text-white/70 dark:hover:bg-white/20",
      ].join(" ")}
    >
      {props.children}
    </Link>
  );
}

function HomeDashboardInner(props: {
  sp: { scope?: string; range?: string; daily?: string; xy_date?: string };
  playlistKey: "all_catalog" | "releases" | "ext";
  title: string;
  rangeDays: number;
  latest: PlaylistDailyStatsRow | null;
  history: PlaylistDailyStatsRow[];
  playlistImageUrl: string | null;
  historyErrorMessage?: string | null;
  trackScatterPoints: TrackStreamsXYPoint[];
  trackScatterErrorMessage?: string | null;
  trackScatterDataDate: string | null;
  latestRunDate: string | null;
  latestDataDate: string | null;
}) {
  const { metric, setMetric } = useMetric();
  const { streamPayoutPerStreamUsd } = usePayoutRate();
  const [selectedChart, setSelectedChart] = useState<"daily" | "total">("daily");
  const [scatterQuery, setScatterQuery] = useState("");
  const deferredScatterQuery = useDeferredValue(scatterQuery);
  const [scatterFocusIsrc, setScatterFocusIsrc] = useState<string | null>(null);
  const [scatterFocusArtistId, setScatterFocusArtistId] = useState<string | null>(null);
  const [scatterSearchFocused, setScatterSearchFocused] = useState(false);
  const [scatterLogScale, setScatterLogScale] = useState(false);
  const [scatterView, setScatterView] = useState<"tracks" | "artists">("tracks");

  const scatterMode = metric === "revenue" ? "revenue" : "streams";
  const scatterTitle =
    scatterView === "artists"
      ? scatterMode === "revenue"
        ? "Artists: Total vs Daily Revenue"
        : "Artists: Total vs Daily Streams"
      : scatterMode === "revenue"
        ? "Tracks: Total vs Daily Revenue"
        : "Tracks: Total vs Daily Streams";

  // Aggregate tracks to artists for artist view
  const artistScatterPoints = useMemo(() => {
    if (scatterView !== "artists") return [];
    return aggregateTracksToArtists(props.trackScatterPoints ?? []);
  }, [props.trackScatterPoints, scatterView]);

  // Track search matches
  const scatterTrackMatches = useMemo(() => {
    if (scatterView !== "tracks") return [];
    const q = foldForSearch(deferredScatterQuery ?? "");
    if (!q) return [];

    const looksLikeIsrc = /^[a-z0-9]{6,}$/.test(q);
    if (!looksLikeIsrc && q.length < 2) return [];

    const out: Array<{ isrc: string; name: string; artists: string; imageUrl: string | null; score: number }> = [];
    for (const p of props.trackScatterPoints ?? []) {
      if (!p?.isrc) continue;
      const isrc = String(p.isrc);
      const isrcL = foldForSearch(isrc);
      const title = String(p.name ?? "").trim();
      const titleL = foldForSearch(title);
      const artistsArr = p.artist_names ?? [];
      const artists = (artistsArr ?? []).filter(Boolean).join(", ");
      const artistsL = foldForSearch(artists);
      const imageUrl = p.album_image_url ?? null;

      let score = Infinity;
      if (isrcL === q) score = 0;
      else if (isrcL.startsWith(q)) score = 1;
      else if (titleL === q) score = 2;
      else if (titleL.startsWith(q)) score = 3;
      else if (titleL.includes(q)) score = 4;
      else if (artistsL.includes(q)) score = 5;
      else continue;

      out.push({ isrc, name: title || isrc, artists, imageUrl, score });
      if (out.length > 50) break;
    }

    out.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
    return out.slice(0, 8);
  }, [deferredScatterQuery, props.trackScatterPoints, scatterView]);

  // Artist search matches
  const scatterArtistMatches = useMemo(() => {
    if (scatterView !== "artists") return [];
    const q = foldForSearch(deferredScatterQuery ?? "");
    if (!q || q.length < 2) return [];

    const out: Array<{ artistId: string; name: string; trackCount: number; score: number }> = [];
    for (const a of artistScatterPoints) {
      const nameL = foldForSearch(a.artist_name);

      let score = Infinity;
      if (nameL === q) score = 0;
      else if (nameL.startsWith(q)) score = 1;
      else if (nameL.includes(q)) score = 2;
      else continue;

      out.push({ artistId: a.artist_id, name: a.artist_name, trackCount: a.track_count, score });
      if (out.length > 50) break;
    }

    out.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
    return out.slice(0, 8);
  }, [deferredScatterQuery, artistScatterPoints, scatterView]);

  const showScatterDropdown =
    scatterSearchFocused &&
    !scatterFocusIsrc &&
    !scatterFocusArtistId &&
    (scatterQuery ?? "").trim().length > 0 &&
    (scatterTrackMatches.length > 0 || scatterArtistMatches.length > 0);

  const series = useMemo(() => {
    const desc = props.history ?? [];

    if (metric === "revenue") {
      const dailyDesc = desc.map((r) => ({
        date: dataDateFromRunDate(r.date),
        value: Number(r.daily_streams_net ?? 0) * streamPayoutPerStreamUsd,
      }));
      const totalDesc = desc.map((r) => ({
        date: dataDateFromRunDate(r.date),
        value: Number(r.total_streams_cumulative ?? 0) * streamPayoutPerStreamUsd,
      }));
      return {
        daily: computeRollingAvg7(dailyDesc),
        total: totalDesc,
        dailyValue: Number(props.latest?.daily_streams_net ?? 0) * streamPayoutPerStreamUsd,
        totalValue: Number(props.latest?.total_streams_cumulative ?? 0) * streamPayoutPerStreamUsd,
        dailyTitle: "Revenue (Daily)",
        totalTitle: "Revenue (Total)",
        dailyValueLabel: "Revenue",
        totalValueLabel: "Revenue",
        valueFormat: "usd" as const,
        yTickFormat: "usd_compact" as const,
        color: "#10b981",
      };
    }

    if (metric === "tracks") {
      const totalDesc = desc.map((r) => ({
        date: dataDateFromRunDate(r.date),
        value: Number(r.track_count ?? 0),
      }));
      const dailyDeltaDesc = desc.map((r, idx) => {
        const prev = idx < desc.length - 1 ? desc[idx + 1] : null;
        const daily = prev ? Number(r.track_count ?? 0) - Number(prev.track_count ?? 0) : 0;
        return { date: dataDateFromRunDate(r.date), value: daily };
      });
      const dailyValue =
        desc.length >= 2
          ? Number(desc[0]?.track_count ?? 0) - Number(desc[1]?.track_count ?? 0)
          : 0;
      return {
        daily: computeRollingAvg7(dailyDeltaDesc),
        total: totalDesc,
        dailyValue,
        totalValue: Number(props.latest?.track_count ?? 0),
        dailyTitle: "Track Change (Daily)",
        totalTitle: "Track Count",
        dailyValueLabel: "Tracks",
        totalValueLabel: "Tracks",
        valueFormat: "int" as const,
        yTickFormat: "int" as const,
        color: "#3b82f6",
      };
    }

    // streams (default)
    const dailyDesc = desc.map((r) => ({
      date: dataDateFromRunDate(r.date),
      value: Number(r.daily_streams_net ?? 0),
    }));
    const totalDesc = desc.map((r) => ({
      date: dataDateFromRunDate(r.date),
      value: Number(r.total_streams_cumulative ?? 0),
    }));
    return {
      daily: computeRollingAvg7(dailyDesc),
      total: totalDesc,
      dailyValue: Number(props.latest?.daily_streams_net ?? 0),
      totalValue: Number(props.latest?.total_streams_cumulative ?? 0),
      dailyTitle: "Daily Streams",
      totalTitle: "Total Streams",
      dailyValueLabel: "Streams",
      totalValueLabel: "Total Streams",
      valueFormat: "int" as const,
      yTickFormat: "k" as const,
      color: "#c7f33c",
    };
  }, [metric, props.history, props.latest, streamPayoutPerStreamUsd]);

  const chartDataDaily: ChartPoint[] = series.daily;
  const chartDataTotal: ChartPoint[] = series.total;

  const allCatalogMa7 = useMemo(() => {
    if (props.playlistKey !== "all_catalog") return null;
    const slice = (props.history ?? []).slice(0, 7);
    if (!slice.length) return null;
    const sum = slice.reduce((acc, r) => acc + Number(r.daily_streams_net ?? 0), 0);
    return sum / slice.length;
  }, [props.history, props.playlistKey]);

  const allCatalogAsOf = props.latest?.date
    ? formatDateISO(dataDateFromRunDate(props.latest.date))
    : null;

  return (
    <div className="space-y-4">
      {/* Header Section */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            {props.playlistKey === "all_catalog" ? (
              <div
                className="sb-ring flex h-10 w-10 items-center justify-center rounded-lg"
                style={{ background: "var(--sb-accent)" }}
              >
                <Music className="h-5 w-5" style={{ color: "black" }} />
              </div>
            ) : props.playlistImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={props.playlistImageUrl}
                alt="Playlist cover"
                className="h-10 w-10 rounded-lg object-cover sb-ring"
              />
            ) : (
              <div className="h-10 w-10 rounded-lg sb-ring bg-white/60" />
            )}
            <div className="flex items-center gap-2">
              <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
                {props.title}
              </h1>
              <a
                href="/api/reports/playlist-streams-7d"
                className={[
                  "inline-flex items-center justify-center rounded p-1 transition-colors",
                  "hover:bg-black/5 dark:hover:bg-white/10",
                  "opacity-30 hover:opacity-100",
                ].join(" ")}
                style={{ color: "var(--sb-muted)" }}
                title="Download 7-day playlist streams report (XLSX)"
                aria-label="Download 7-day playlist streams report (XLSX)"
              >
                <Download className="h-4 w-4" />
              </a>
              {props.latest?.track_count !== null && props.latest?.track_count !== undefined && (
                <span
                  className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-wide"
                  style={{
                    borderColor: "var(--sb-border)",
                    backgroundColor: "var(--sb-surface)",
                    color: "var(--sb-muted)",
                  }}
                >
                  {formatInt(props.latest.track_count)} tracks
                </span>
              )}
            </div>
          </div>
          <p className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
            Overview of your catalog performance across all playlists.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <div className="sb-ring flex items-center gap-0.5 rounded-full bg-white/60 p-0.5 dark:bg-white/10">
            <ToggleLink
              active={props.playlistKey === "all_catalog"}
              href={hrefWith(props.sp, { scope: "all_catalog" })}
            >
              All
            </ToggleLink>
            <ToggleLink
              active={props.playlistKey === "releases"}
              href={hrefWith(props.sp, { scope: "releases" })}
            >
              Releases
            </ToggleLink>
            <ToggleLink
              active={props.playlistKey === "ext"}
              href={hrefWith(props.sp, { scope: "ext" })}
            >
              Ext
            </ToggleLink>
          </div>

          <MetricSelector metric={metric} setMetric={setMetric} />

          <div className="sb-ring flex items-center gap-0.5 rounded-full bg-white/60 p-0.5 dark:bg-white/10">
            <ToggleLink active={props.rangeDays === 30} href={hrefWith(props.sp, { range: "30" })}>
              30d
            </ToggleLink>
            <ToggleLink active={props.rangeDays === 90} href={hrefWith(props.sp, { range: "90" })}>
              90d
            </ToggleLink>
            <ToggleLink active={props.rangeDays === 365} href={hrefWith(props.sp, { range: "365" })}>
              365d
            </ToggleLink>
          </div>
        </div>
      </div>

      {props.playlistKey === "all_catalog" && allCatalogMa7 !== null ? (
        <blockquote
          className="rounded-lg border-l-4 bg-black/[0.02] p-3 text-sm dark:bg-white/[0.04]"
          style={{ borderColor: "var(--sb-accent)" }}
        >
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="font-semibold" style={{ color: "var(--sb-text)" }}>
              </span>
            <span className="font-mono" style={{ color: "var(--sb-text)" }}>
              {formatInt(Math.round(allCatalogMa7))}
            </span>
            <span className="text-xs" style={{ color: "var(--sb-muted)" }}>
              MA7 daily streams
              {allCatalogAsOf ? ` (as of ${allCatalogAsOf})` : ""}
            </span>
          </div>
        </blockquote>
      ) : null}

      <LazyInteractiveChartSection
        dailyStreamsData={chartDataDaily}
        totalStreamsData={chartDataTotal}
        dailyStreamsValue={series.dailyValue}
        totalStreamsValue={series.totalValue}
        rangeDays={props.rangeDays}
        dailyTitle={series.dailyTitle}
        totalTitle={series.totalTitle}
        dailyValueLabel={series.dailyValueLabel}
        totalValueLabel={series.totalValueLabel}
        valueFormat={series.valueFormat}
        yTickFormat={series.yTickFormat}
        color={series.color}
        selectedChart={selectedChart}
        onSelectChart={setSelectedChart}
      />

      {/* Additional Stat Cards (keep existing ones) */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
        <StatCard
          title="Streams (7d)"
          value={<AnimatedCounter value={rollSum(props.history ?? [], 7, "streams", streamPayoutPerStreamUsd)} />}
          subtitle={formatUsd(rollSum(props.history ?? [], 7, "revenue", streamPayoutPerStreamUsd))}
        />
        <StatCard
          title="Streams (30d)"
          value={<AnimatedCounter value={rollSum(props.history ?? [], 30, "streams", streamPayoutPerStreamUsd)} />}
          subtitle={formatUsd(rollSum(props.history ?? [], 30, "revenue", streamPayoutPerStreamUsd))}
        />
      </div>

      {props.historyErrorMessage ? (
        <Alert variant="error" title="Query error">
          {props.historyErrorMessage}
        </Alert>
      ) : null}

      {/* Track/Artist XY scatter */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold tracking-tight">{scatterTitle}</h2>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div
              className="text-[11px] opacity-60"
              title={scatterMode === "revenue" ? "X = cumulative revenue, Y = daily revenue change" : "X = cumulative streams, Y = daily streams change"}
            >
              {scatterMode === "revenue" ? "X: total revenue • Y: daily revenue" : "X: total streams • Y: daily streams"}
            </div>
            <div className="flex items-center gap-2">
              {/* Tracks / Artists toggle */}
              <div className="flex items-center rounded-full bg-black/5 p-0.5 dark:bg-white/10">
                <button
                  type="button"
                  onClick={() => {
                    setScatterView("tracks");
                    setScatterFocusIsrc(null);
                    setScatterFocusArtistId(null);
                    setScatterQuery("");
                  }}
                  className={[
                    "rounded-full px-2 py-1 text-[11px] font-medium transition",
                    scatterView === "tracks"
                      ? "bg-black text-white dark:bg-white dark:text-black"
                      : "text-black/70 hover:bg-white/50 dark:text-white/70 dark:hover:bg-white/20",
                  ].join(" ")}
                >
                  Tracks
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setScatterView("artists");
                    setScatterFocusIsrc(null);
                    setScatterFocusArtistId(null);
                    setScatterQuery("");
                  }}
                  className={[
                    "rounded-full px-2 py-1 text-[11px] font-medium transition",
                    scatterView === "artists"
                      ? "bg-black text-white dark:bg-white dark:text-black"
                      : "text-black/70 hover:bg-white/50 dark:text-white/70 dark:hover:bg-white/20",
                  ].join(" ")}
                >
                  Artists
                </button>
              </div>
              <button
                type="button"
                onClick={() => setScatterLogScale((v) => !v)}
                className={[
                  "rounded-full px-2 py-1 text-[11px] font-medium transition",
                  scatterLogScale
                    ? "bg-black text-white dark:bg-white dark:text-black"
                    : "text-black/70 hover:bg-white/70 dark:text-white/70 dark:hover:bg-white/20",
                ].join(" ")}
                title={scatterLogScale ? "Switch to linear scale" : "Switch to log scale"}
              >
                {scatterLogScale ? "Log" : "Linear"}
              </button>
              <DatePicker
                value={props.trackScatterDataDate ?? props.latestDataDate ?? ""}
                min={
                  props.history?.length
                    ? dataDateFromRunDate((props.history ?? [])[props.history.length - 1]?.date ?? "")
                    : undefined
                }
                max={props.latestDataDate ?? undefined}
                path="/"
                param="xy_date"
              />
            </div>
          </div>
        </div>
        {props.trackScatterErrorMessage ? (
          <Alert variant="error" title="Track scatter query error">
            {props.trackScatterErrorMessage}
          </Alert>
        ) : null}
        <div
          className="rounded-xl border bg-white/50 p-3 dark:bg-white/[0.03]"
          style={{ borderColor: "var(--sb-border)" }}
        >
          {/* Search (focus mode) */}
          <div className="mb-3">
            <div className="relative">
              <div
                className="sb-ring flex items-center gap-2 rounded-lg bg-white/60 px-3 py-2 dark:bg-white/10"
                style={{ borderColor: "var(--sb-border)" }}
              >
                <Search className="h-4 w-4 opacity-60" style={{ color: "var(--sb-muted)" }} />
                <input
                  value={scatterQuery}
                  onChange={(e) => setScatterQuery(e.target.value)}
                  onFocus={() => {
                    setScatterSearchFocused(true);
                    // If something is selected, focusing the input should clear it.
                    if (scatterFocusIsrc || scatterFocusArtistId) {
                      setScatterFocusIsrc(null);
                      setScatterFocusArtistId(null);
                      setScatterQuery("");
                    }
                  }}
                  onBlur={() => setScatterSearchFocused(false)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      if (scatterView === "tracks") {
                        const first = scatterTrackMatches[0];
                        if (first?.isrc) {
                          setScatterFocusIsrc(first.isrc);
                          setScatterQuery(first.name || first.isrc);
                          setScatterSearchFocused(false);
                        }
                      } else {
                        const first = scatterArtistMatches[0];
                        if (first?.artistId) {
                          setScatterFocusArtistId(first.artistId);
                          setScatterQuery(first.name);
                          setScatterSearchFocused(false);
                        }
                      }
                    }
                    if (e.key === "Escape") {
                      setScatterFocusIsrc(null);
                      setScatterFocusArtistId(null);
                      setScatterQuery("");
                      setScatterSearchFocused(false);
                    }
                  }}
                  placeholder={scatterView === "tracks" ? "Search track (title, artist, ISRC)…" : "Search artist…"}
                  className="w-full bg-transparent text-xs outline-none placeholder:opacity-60"
                  style={{ color: "var(--sb-text)" }}
                />
                {(scatterQuery || scatterFocusIsrc || scatterFocusArtistId) ? (
                  <button
                    type="button"
                    className="rounded p-1 transition hover:bg-black/5 dark:hover:bg-white/10"
                    onClick={() => {
                      setScatterFocusIsrc(null);
                      setScatterFocusArtistId(null);
                      setScatterQuery("");
                    }}
                    title="Clear"
                    aria-label="Clear"
                  >
                    <X className="h-4 w-4" style={{ color: "var(--sb-muted)" }} />
                  </button>
                ) : null}
              </div>

              {showScatterDropdown ? (
                <div
                  className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 overflow-hidden rounded-lg border bg-white/90 shadow-lg backdrop-blur dark:bg-black/60"
                  style={{ borderColor: "var(--sb-border)" }}
                >
                  {scatterView === "tracks" ? (
                    scatterTrackMatches.map((m) => (
                      <button
                        key={m.isrc}
                        type="button"
                        className="flex w-full items-start gap-2 px-3 py-2 text-left text-xs transition hover:bg-black/5 dark:hover:bg-white/10"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setScatterFocusIsrc(m.isrc);
                          setScatterQuery(m.name || m.isrc);
                          setScatterSearchFocused(false);
                        }}
                      >
                        {m.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={m.imageUrl}
                            alt=""
                            className="mt-0.5 h-8 w-8 rounded-md object-cover sb-ring"
                          />
                        ) : (
                          <div className="mt-0.5 h-8 w-8 rounded-md sb-ring bg-white/60 dark:bg-white/10" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium" style={{ color: "var(--sb-text)" }}>
                            {m.name}
                          </div>
                          {m.artists ? (
                            <div className="truncate text-[11px] opacity-70" style={{ color: "var(--sb-muted)" }}>
                              {m.artists}
                            </div>
                          ) : null}
                        </div>
                        <div className="shrink-0 font-mono text-[11px] opacity-60" style={{ color: "var(--sb-muted)" }}>
                          {m.isrc}
                        </div>
                      </button>
                    ))
                  ) : (
                    scatterArtistMatches.map((m) => (
                      <button
                        key={m.artistId}
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition hover:bg-black/5 dark:hover:bg-white/10"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setScatterFocusArtistId(m.artistId);
                          setScatterQuery(m.name);
                          setScatterSearchFocused(false);
                        }}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium" style={{ color: "var(--sb-text)" }}>
                            {m.name}
                          </div>
                          <div className="truncate text-[11px] opacity-70" style={{ color: "var(--sb-muted)" }}>
                            {m.trackCount} track{m.trackCount !== 1 ? "s" : ""}
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>

            {scatterFocusIsrc ? (
              <div className="mt-2 text-[11px] opacity-70" style={{ color: "var(--sb-muted)" }}>
                Focus mode: showing <span className="font-mono">{scatterFocusIsrc}</span>
              </div>
            ) : null}
            {scatterFocusArtistId ? (
              <div className="mt-2 text-[11px] opacity-70" style={{ color: "var(--sb-muted)" }}>
                Focus mode: showing artist
              </div>
            ) : null}
          </div>

          {/* Tracks chart */}
          {scatterView === "tracks" ? (
            props.trackScatterPoints?.length ? (
              <TrackStreamsXYChart
                points={props.trackScatterPoints}
                mode={scatterMode}
                payoutPerStreamUsd={streamPayoutPerStreamUsd}
                focusIsrc={scatterFocusIsrc}
                logScale={scatterLogScale}
                topNDelta={scatterLogScale ? 750 : 100}
                topNCumulative={scatterLogScale ? 750 : 100}
                sampleN={scatterLogScale ? 0 : 80}
                onClearFocus={() => {
                  setScatterFocusIsrc(null);
                  setScatterQuery("");
                  setScatterSearchFocused(false);
                }}
              />
            ) : (
              <div className="py-10 text-center text-xs" style={{ color: "var(--sb-muted)" }}>
                No track points available yet.
              </div>
            )
          ) : null}

          {/* Artists chart */}
          {scatterView === "artists" ? (
            artistScatterPoints.length ? (
              <ArtistStreamsXYChart
                points={artistScatterPoints}
                mode={scatterMode}
                payoutPerStreamUsd={streamPayoutPerStreamUsd}
                focusArtistId={scatterFocusArtistId}
                logScale={scatterLogScale}
                topNDelta={scatterLogScale ? 300 : 100}
                topNCumulative={scatterLogScale ? 300 : 100}
                sampleN={scatterLogScale ? 0 : 80}
                onClearFocus={() => {
                  setScatterFocusArtistId(null);
                  setScatterQuery("");
                  setScatterSearchFocused(false);
                }}
              />
            ) : (
              <div className="py-10 text-center text-xs" style={{ color: "var(--sb-muted)" }}>
                No artist points available yet.
              </div>
            )
          ) : null}
        </div>
      </div>

      {/* Recent History Table */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold tracking-tight">Recent History</h2>
        <GlassTable 
          headers={[
            { label: "Date" },
            { label: "Tracks", align: "right" },
            { label: "" }, // Invisible column for track delta
            { label: metric === "revenue" ? "Total Revenue" : "Total Streams", align: "right" },
            { label: metric === "revenue" ? "Daily Revenue" : "Daily Streams", align: "right" },
          ]}
          // Constrain height so ~7 rows are visible; scroll for more.
          maxBodyHeightClassName="max-h-[228px] overflow-auto"
        >
          {(props.history ?? []).map((r, idx) => {
            const prev = idx < (props.history ?? []).length - 1 ? (props.history ?? [])[idx + 1] : null;
            const trackDelta = prev ? Number(r.track_count ?? 0) - Number(prev.track_count ?? 0) : 0;
            return (
            <TableRow key={r.date}>
              <TableCell mono>{formatDateISO(dataDateFromRunDate(r.date))}</TableCell>
              <TableCell numeric>{formatInt(r.track_count)}</TableCell>
              <TableCell className="w-12 pl-1 pr-0 text-xs">
                {trackDelta !== 0 && (
                  <span className={trackDelta > 0 ? "text-blue-600 dark:text-blue-400" : "text-red-600 dark:text-red-400"}>
                    {trackDelta > 0 ? "+" : ""}{formatInt(trackDelta)}
                  </span>
                )}
              </TableCell>
              <TableCell numeric>
                {metric === "revenue"
                  ? formatUsd(Number(r.total_streams_cumulative ?? 0) * streamPayoutPerStreamUsd)
                  : formatInt(r.total_streams_cumulative)}
              </TableCell>
              <TableCell numeric className={metric === "revenue" ? "text-green-600 dark:text-green-400 font-medium" : "text-lime-700 dark:text-lime-400 font-medium"}>
                {metric === "revenue"
                  ? formatUsd(Number(r.daily_streams_net ?? 0) * streamPayoutPerStreamUsd)
                  : formatInt(r.daily_streams_net)}
              </TableCell>
            </TableRow>
            );
          })}
          {!props.history?.length && <EmptyState colSpan={5} message="No stats found yet" />}
        </GlassTable>
      </div>
    </div>
  );
}

function rollSum(
  rowsDesc: PlaylistDailyStatsRow[],
  days: number,
  kind: "streams" | "revenue",
  payoutPerStreamUsd: number,
) {
  const slice = rowsDesc.slice(0, days);
  let sum = 0;
  for (const r of slice) {
    if (kind === "streams") sum += Number(r.daily_streams_net ?? 0);
    else sum += Number(r.daily_streams_net ?? 0) * payoutPerStreamUsd;
  }
  return sum;
}

export function HomeDashboardClient(props: {
  sp: { scope?: string; range?: string; daily?: string; xy_date?: string };
  playlistKey: "all_catalog" | "releases" | "ext";
  title: string;
  rangeDays: number;
  latest: PlaylistDailyStatsRow | null;
  history: PlaylistDailyStatsRow[];
  playlistImageUrl: string | null;
  historyErrorMessage?: string | null;
  trackScatterPoints: TrackStreamsXYPoint[];
  trackScatterErrorMessage?: string | null;
  trackScatterDataDate: string | null;
  latestRunDate: string | null;
  latestDataDate: string | null;
}) {
  return (
    <MetricProvider defaultMetric="streams">
      <HomeDashboardInner {...props} />
    </MetricProvider>
  );
}
