"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ExternalLink, User, ChevronRight, Download, List } from "lucide-react";
import { formatDateISO, formatInt } from "@/lib/format";
import { GlassTable, TableCell, TableRow, EmptyState } from "@/components/ui/GlassTable";
import { CatalogMetricSelector, type Metric } from "./CatalogMetricSelector";
import { CatalogMetricsClient } from "./CatalogMetricsClient";
import { Combobox } from "@/components/ui/Combobox";
import { SpotlightCard } from "@/components/ui/SpotlightCard";
import { DailyStreamsChart } from "@/components/charts/DailyStreamsChart";
import { DailyStreamsWithMAChart } from "@/components/charts/DailyStreamsWithMAChart";
import { StatCard } from "@/components/StatCard";
import { AnimatedCounter } from "@/components/ui/AnimatedCounter";
import { ChartCsvDownloadButton } from "@/components/charts/ChartCsvDownloadButton";
import { downloadCsv, slugifyForFilename, todayIsoDate } from "@/lib/csv";
import { dataDateFromRunDate } from "@/lib/sotDates";

type ChartDataPoint = {
  date: string;
  value: number;
};

type DailyDataPoint = {
  date: string;
  daily: number;
};

type ArtistOption = { id: string; name: string; imageUrl?: string | null };
type TrackOption = { isrc: string; name: string; albumImageUrl?: string | null };
type TopTrack = {
  isrc: string;
  name: string | null;
  total: number | null;
  daily: number | null;
  albumImageUrl: string | null;
};
type TrackSeriesPoint = { date: string; value: number };
type TrackDailyPoint = { date: string; daily: number; ma7?: number | null };
type SelectedTrack = {
  name: string | null;
  albumImageUrl: string | null;
  spotifyTrackId: string | null;
  artistNames: string[] | null;
  artistIds: string[] | null;
};

const STREAM_PAYOUT_USD = 0.002;

export function CatalogPageClient(props: {
  latestCum: number;
  latestDate: string | null;
  rangeDays: number;
  cumSeriesAsc: ChartDataPoint[];
  dailyArtistDesc: DailyDataPoint[];
  artist24h: number;
  artist7d: number;
  artist28d: number;
  artist30d: number;
  trackCount: number;
  artists: ArtistOption[];
  artistId: string;
  tracks: TrackOption[];
  isrc: string | null;
  artistName: string;
  artistImageUrl: string | null;
  topByCumulative: TopTrack[];
  topByDaily: TopTrack[];
  selectedTrack: SelectedTrack | null;
  trackCumDesc: TrackSeriesPoint[];
  trackDailyWithMaDesc: TrackDailyPoint[];
  track24h: number;
  track7d: number;
  track28d: number;
  track30d: number;
}) {
  const [metric, setMetric] = useState<Metric>("streams");
  const [isArtistExpanded, setIsArtistExpanded] = useState(true);
  const router = useRouter();
  const sp = useSearchParams();

  function hrefWith(patch: Record<string, string | null | undefined>) {
    const u = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined || v === "") u.delete(k);
      else u.set(k, v);
    }
    return `?${u.toString()}`;
  }

  function downloadTopTracksAsCsv(data: TopTrack[], filename: string, isDaily: boolean) {
    downloadCsv({
      filename,
      rows: data.map((t) => ({
        track: t.name ?? t.isrc,
        isrc: t.isrc,
        value: isDaily ? t.daily : t.total,
      })) as Array<Record<string, unknown>>,
      headers: ["track", "isrc", "value"],
      sortForExport: false,
    });
  }

  return (
    <>
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
            {props.latestDate ? (
              <>
                Latest data date:{" "}
                <span className="font-mono">{formatDateISO(dataDateFromRunDate(props.latestDate))}</span>
              </>
            ) : (
              "No ingestion date found yet."
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <CatalogMetricSelector metric={metric} setMetric={setMetric} />
          <Link
            href="/catalog/config"
            className="sb-ring grid h-8 w-8 place-items-center rounded-full bg-white/70 text-xs font-medium transition hover:bg-white dark:bg-white/10 dark:hover:bg-white/15"
            aria-label="Catalog config"
            title="Catalog config"
          >
            <List className="h-4 w-4" style={{ color: "var(--sb-text)" }} />
          </Link>
        </div>
      </div>

      <div className="sticky top-0 z-20 rounded-xl border border-lime-500/20 bg-lime-500/10 p-3 shadow-sm backdrop-blur-sm dark:bg-lime-400/10 dark:border-lime-400/20">
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={() => setIsArtistExpanded(!isArtistExpanded)}
            className="sb-ring mt-0.5 inline-flex items-center justify-center rounded p-1 transition-colors hover:bg-white/10 dark:hover:bg-white/5"
            aria-label={isArtistExpanded ? "Collapse artist info" : "Expand artist info"}
            style={{ color: "var(--sb-muted)" }}
          >
            <ChevronRight
              className={`h-3.5 w-3.5 transition-transform duration-200 ${
                isArtistExpanded ? "rotate-90" : ""
              }`}
            />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="flex items-center gap-2">
                  <div className="text-xs font-medium">Artist</div>
                  <div className="sb-ring rounded-xl bg-black/10 px-2.5 py-1.5 dark:bg-white/10 min-w-[280px] w-full max-w-[400px]">
                    <Combobox
                      ariaLabel="Select artist"
                      value={props.artistId}
                      options={props.artists.map((a) => ({ value: a.id, label: a.name, imageUrl: a.imageUrl }))}
                      placeholder="Type an artist…"
                      onChange={(id) => {
                        router.push(hrefWith({ artist_id: id, isrc: null }));
                      }}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="text-xs font-medium">Track</div>
                  <div className="sb-ring rounded-xl bg-black/10 px-2.5 py-1.5 dark:bg-white/10 min-w-[280px] w-full max-w-[400px]">
                    <Combobox
                      ariaLabel="Select track"
                      value={props.isrc ?? null}
                      options={[
                        { value: "", label: "(none)" },
                        ...props.tracks.map((t) => ({ value: t.isrc, label: t.name, imageUrl: t.albumImageUrl })),
                      ]}
                      placeholder="Type a track…"
                      onChange={(isrc) => {
                        router.push(hrefWith({ isrc: isrc || null }));
                      }}
                      imageShape="square"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="sb-ring flex items-center gap-0.5 rounded-full bg-black/10 p-0.5 dark:bg-white/10">
                  {[30, 90, 365].map((d) => (
                    <Link
                      key={d}
                      href={hrefWith({ range: String(d) })}
                      className={[
                        "rounded-full px-2.5 py-1.5 text-[11px] font-medium transition",
                        props.rangeDays === d
                          ? "bg-black text-white shadow-sm dark:bg-white dark:text-black"
                          : "hover:bg-black/10 dark:hover:bg-white/10",
                      ].join(" ")}
                      style={
                        props.rangeDays === d
                          ? undefined
                          : { opacity: 0.7 }
                      }
                    >
                      {d}d
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        className={`overflow-hidden transition-all duration-300 ease-in-out ${
          isArtistExpanded ? "max-h-[5000px] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <div className="space-y-4 pt-2">
          <div className="flex items-center gap-4">
            {props.artistImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={props.artistImageUrl}
                alt={props.artistName}
                className="h-16 w-16 rounded-full object-cover sb-ring"
              />
            ) : (
              <div className="h-16 w-16 rounded-full sb-ring bg-white/60 flex items-center justify-center">
                <User className="h-8 w-8 opacity-40" />
              </div>
            )}
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-display text-2xl font-semibold tracking-tight">
                  <Link
                    href={`/artists/${props.artistId}`}
                    className="transition-colors hover:text-lime-600 dark:hover:text-lime-400"
                  >
                    {props.artistName}
                  </Link>
                </h1>
                <Link
                  href={`https://open.spotify.com/artist/${props.artistId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center rounded-full p-1.5 transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                  title="Open on Spotify"
                  style={{ color: "var(--sb-muted)" }}
                >
                  <ExternalLink className="h-4 w-4" />
                </Link>
              </div>
              <div className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
                {formatInt(props.trackCount)} {props.trackCount === 1 ? "track" : "tracks"}
              </div>
            </div>
          </div>

          <CatalogMetricsClient
            latestCum={props.latestCum}
            latestDate={props.latestDate}
            rangeDays={props.rangeDays}
            cumSeriesAsc={props.cumSeriesAsc}
            dailyArtistDesc={props.dailyArtistDesc}
            artist24h={props.artist24h}
            artist7d={props.artist7d}
            artist28d={props.artist28d}
            artist30d={props.artist30d}
            trackCount={props.trackCount}
            metric={metric}
            setMetric={setMetric}
          />

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="space-y-3">
              <div className="flex items-end justify-between px-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold">Top tracks (cumulative)</h2>
                  <button
                    type="button"
                    onClick={() => downloadTopTracksAsCsv(
                      props.topByCumulative,
                      `top-tracks-cumulative-${slugifyForFilename(props.artistName)}-${todayIsoDate()}.csv`,
                      false
                    )}
                    className="inline-flex items-center justify-center p-0 transition-colors hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                    title="Download as CSV"
                    style={{ color: "var(--sb-muted)" }}
                  >
                    <Download className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <GlassTable headers={["", "Track", "ISRC", "Total"]}>
                {props.topByCumulative.map((t) => (
                  <TableRow key={t.isrc}>
                    <TableCell>
                      {t.albumImageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={t.albumImageUrl}
                          alt="Album cover"
                          className="h-8 w-8 rounded-lg object-cover sb-ring"
                        />
                      ) : (
                        <div className="h-8 w-8 rounded-lg sb-ring bg-white/60" />
                      )}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/tracks/${t.isrc}`}
                        className="font-medium transition-colors hover:text-lime-600 dark:hover:text-lime-400"
                      >
                        {t.name ?? t.isrc}
                      </Link>
                    </TableCell>
                    <TableCell mono className="text-xs opacity-40" style={{ color: "var(--sb-muted)" }}>
                      {t.isrc}
                    </TableCell>
                    <TableCell>{t.total === null ? "—" : formatInt(t.total)}</TableCell>
                  </TableRow>
                ))}
                {!props.topByCumulative.length && (
                  <EmptyState colSpan={4} message="No track totals found" />
                )}
              </GlassTable>
            </div>

            <div className="space-y-3">
              <div className="flex items-end justify-between px-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold">Top tracks (daily)</h2>
                  <button
                    type="button"
                    onClick={() => downloadTopTracksAsCsv(
                      props.topByDaily,
                      `top-tracks-daily-${slugifyForFilename(props.artistName)}-${todayIsoDate()}.csv`,
                      true
                    )}
                    className="inline-flex items-center justify-center p-0 transition-colors hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                    title="Download as CSV"
                    style={{ color: "var(--sb-muted)" }}
                  >
                    <Download className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <GlassTable headers={["", "Track", "ISRC", "Daily"]}>
                {props.topByDaily.map((t) => (
                  <TableRow key={t.isrc}>
                    <TableCell>
                      {t.albumImageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={t.albumImageUrl}
                          alt="Album cover"
                          className="h-8 w-8 rounded-lg object-cover sb-ring"
                        />
                      ) : (
                        <div className="h-8 w-8 rounded-lg sb-ring bg-white/60" />
                      )}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/tracks/${t.isrc}`}
                        className="font-medium transition-colors hover:text-lime-600 dark:hover:text-lime-400"
                      >
                        {t.name ?? t.isrc}
                      </Link>
                    </TableCell>
                    <TableCell mono className="text-xs opacity-40" style={{ color: "var(--sb-muted)" }}>
                      {t.isrc}
                    </TableCell>
                    <TableCell className="font-medium text-lime-700 dark:text-lime-400">
                      {t.daily === null ? "—" : `+${formatInt(t.daily)}`}
                    </TableCell>
                  </TableRow>
                ))}
                {!props.topByDaily.length && (
                  <EmptyState colSpan={4} message="No daily deltas found" />
                )}
              </GlassTable>
            </div>
          </div>
        </div>
      </div>

      {/* Selected track panels (not part of artist collapse) */}
      <div className="space-y-3 border-t pt-3" style={{ borderColor: "var(--sb-border)" }}>
        {props.isrc && props.selectedTrack ? (
          <div className="flex items-center gap-3">
            {props.selectedTrack.albumImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={props.selectedTrack.albumImageUrl}
                alt="Album cover"
                className="h-16 w-16 rounded-lg object-cover sb-ring"
              />
            ) : (
              <div className="h-16 w-16 rounded-lg sb-ring bg-white/60" />
            )}
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-display text-2xl font-semibold tracking-tight">
                  <Link
                    href={`/tracks/${props.isrc}`}
                    className="transition-colors hover:text-lime-600 dark:hover:text-lime-400"
                  >
                    {props.selectedTrack.name ?? props.isrc}
                  </Link>
                </h1>
                {props.selectedTrack.spotifyTrackId && (
                  <Link
                    href={`https://open.spotify.com/track/${props.selectedTrack.spotifyTrackId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center rounded-full p-1.5 transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                    title="Open on Spotify"
                    style={{ color: "var(--sb-muted)" }}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                )}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-xs" style={{ color: "var(--sb-muted)" }}>
                {props.selectedTrack.artistNames?.length ? (
                  <>
                    <span>{props.selectedTrack.artistNames.join(", ")}</span>
                    <span>•</span>
                  </>
                ) : null}
                <span>
                  ISRC: <span className="font-mono">{props.isrc}</span>
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-end justify-between px-1">
            <h2 className="text-sm font-semibold">Selected track</h2>
            <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
              Pick a track to show track-specific panels.
            </div>
          </div>
        )}

        {props.isrc ? (() => {
          // For track panels, "Tracks" doesn’t mean anything (it’s always 1),
          // so we keep the track charts on streams when metric === "tracks".
          const trackMode: "revenue" | "streams" = metric === "revenue" ? "revenue" : "streams";
          const valueFormat = trackMode === "revenue" ? ("usd" as const) : ("int" as const);
          const yTickFormat = trackMode === "revenue" ? ("usd_compact" as const) : ("k" as const);

          const cumSeries = trackMode === "revenue"
            ? props.trackCumDesc.map((p) => ({ date: dataDateFromRunDate(p.date), value: p.value * STREAM_PAYOUT_USD }))
            : props.trackCumDesc.map((p) => ({ date: dataDateFromRunDate(p.date), value: p.value }));

          const dailySeries = trackMode === "revenue"
            ? props.trackDailyWithMaDesc.map((p) => ({
                date: dataDateFromRunDate(p.date),
                daily: p.daily * STREAM_PAYOUT_USD,
                ma7: p.ma7 == null ? p.ma7 : p.ma7 * STREAM_PAYOUT_USD,
              }))
            : props.trackDailyWithMaDesc.map((p) => ({
                date: dataDateFromRunDate(p.date),
                daily: p.daily,
                ma7: p.ma7,
              }));

          const stat24h = trackMode === "revenue" ? props.track24h * STREAM_PAYOUT_USD : props.track24h;
          const stat7d = trackMode === "revenue" ? props.track7d * STREAM_PAYOUT_USD : props.track7d;
          const stat28d = trackMode === "revenue" ? props.track28d * STREAM_PAYOUT_USD : props.track28d;
          const stat30d = trackMode === "revenue" ? props.track30d * STREAM_PAYOUT_USD : props.track30d;

          const cumulativeTitle = trackMode === "revenue" ? "Track cumulative revenue" : "Track cumulative streams";
          const dailyTitle = trackMode === "revenue" ? "Track daily revenue" : "Track daily streams";
          const dailyLabel = trackMode === "revenue" ? "Daily revenue" : "Daily streams";
          const totalLabel = trackMode === "revenue" ? "Total revenue" : "Total streams";
          const statSubtitle = trackMode === "revenue" ? "Est. revenue" : "Net streams";

          // Use emerald for revenue, lime for streams (tracks don't have a separate mode like artist/playlist)
          const trackChartColor = trackMode === "revenue" ? "#10b981" : "#c7f33c";

          return (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
              <SpotlightCard className="lg:col-span-7 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[11px] font-medium uppercase tracking-wider opacity-60">
                    {cumulativeTitle}
                  </div>
                  <ChartCsvDownloadButton
                    rows={cumSeries as unknown as Array<Record<string, unknown>>}
                    filename={`catalog-track-${slugifyForFilename(cumulativeTitle)}-${props.rangeDays}d-${todayIsoDate()}.csv`}
                    title="Download CSV"
                  />
                </div>
                <div className="mt-2 min-h-[180px]">
                  <DailyStreamsChart
                    data={cumSeries}
                    valueLabel={totalLabel}
                    valueFormat={valueFormat}
                    yTickFormat={yTickFormat}
                    heightPx={220}
                    isCumulative={true}
                    color={trackChartColor}
                  />
                </div>
              </SpotlightCard>

              <SpotlightCard className="lg:col-span-5 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[11px] font-medium uppercase tracking-wider opacity-60">
                    {dailyTitle}
                  </div>
                  <ChartCsvDownloadButton
                    rows={dailySeries as unknown as Array<Record<string, unknown>>}
                    filename={`catalog-track-${slugifyForFilename(dailyTitle)}-${props.rangeDays}d-${todayIsoDate()}.csv`}
                    title="Download CSV"
                  />
                </div>
                <div className="mt-2 min-h-[180px]">
                  <DailyStreamsWithMAChart
                    data={dailySeries}
                    valueLabel={dailyLabel}
                    valueFormat={valueFormat}
                    yTickFormat={yTickFormat}
                    heightPx={220}
                    dailyColor={trackChartColor}
                  />
                </div>
              </SpotlightCard>
            </div>
          );
        })() : null}
      </div>
    </>
  );
}
