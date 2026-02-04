"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ExternalLink, User, ChevronRight, Download, List } from "lucide-react";
import { formatDateISO, formatInt, formatUsd } from "@/lib/format";
import { GlassTable, TableCell, TableRow, EmptyState } from "@/components/ui/GlassTable";
import { CatalogMetricsClient } from "./CatalogMetricsClient";
import { Combobox } from "@/components/ui/Combobox";
import { SpotlightCard } from "@/components/ui/SpotlightCard";
import { DailyStreamsChart } from "@/components/charts/DailyStreamsChart";
import { DailyStreamsWithMAChart } from "@/components/charts/DailyStreamsWithMAChart";
import { ChartCsvDownloadButton } from "@/components/charts/ChartCsvDownloadButton";
import { downloadCsv, slugifyForFilename, todayIsoDate } from "@/lib/csv";
import { dataDateFromRunDate } from "@/lib/sotDates";
import { ArtistLinks } from "@/components/ui/ArtistLinks";
import { PageHeader } from "@/components/shell/PageHeader";
import { hrefWithPatchedSearchParams } from "@/lib/searchParams";
import { FilterBar } from "@/components/ui/FilterBar";
import { ChipGroup } from "@/components/ui/Chip";
import { IconButton } from "@/components/ui/Button";
import { usePayoutRate } from "@/components/payout/PayoutRateContext";
import { useMetric } from "@/components/metrics/MetricContext";

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
  artistNames?: string[] | null;
  artistIds?: string[] | null;
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
  artistOverrideAnnotations: Array<{ date: string; note: string; title?: string; imageUrl?: string | null }>;
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
  trackOverrideAnnotations: Array<{ date: string; note: string }>;
  track24h: number;
  track7d: number;
  track28d: number;
  track30d: number;
}) {
  const { metric } = useMetric();
  const [isArtistExpanded, setIsArtistExpanded] = useState(true);
  const router = useRouter();
  const sp = useSearchParams();
  const { streamPayoutPerStreamUsd } = usePayoutRate();

  // Top-track tables only make sense for streams/revenue; treat "tracks" as streams.
  const topTracksMode: "streams" | "revenue" = metric === "revenue" ? "revenue" : "streams";
  const topTracksNumberStyle =
    topTracksMode === "revenue"
      ? ({ color: "#10b981" } as const) // emerald-500
      : ({ color: "var(--sb-accent-stroke)" } as const);

  function downloadTopTracksAsCsv(data: TopTrack[], filename: string, isDaily: boolean) {
    downloadCsv({
      filename,
      rows: data.map((t) => ({
        track: t.name ?? t.isrc,
        isrc: t.isrc,
        value:
          topTracksMode === "revenue"
            ? (isDaily ? t.daily : t.total) == null
              ? null
              : (Number(isDaily ? t.daily : t.total) * streamPayoutPerStreamUsd)
            : isDaily
            ? t.daily
            : t.total,
      })) as Array<Record<string, unknown>>,
      headers: ["track", "isrc", "value"],
      sortForExport: false,
    });
  }

  return (
    <>
      <PageHeader
        title="Catalog"
        subtitle={
          props.latestDate ? (
            <>
              Latest data date:{" "}
              <span className="font-mono">
                {formatDateISO(dataDateFromRunDate(props.latestDate))}
              </span>
            </>
          ) : (
            "No ingestion date found yet."
          )
        }
        actions={
          <>
            <ChipGroup segmented className="text-[11px]">
              {[30, 90, 365].map((d) => (
                <Link
                  key={d}
                  href={hrefWithPatchedSearchParams(sp, { range: String(d) })}
                  className={[
                    "rounded-full px-2.5 py-1.5 text-[11px] font-medium transition",
                    props.rangeDays === d
                      ? "bg-black text-white shadow-sm dark:bg-white dark:text-black"
                      : "text-black/70 hover:bg-black/5 dark:text-white/70 dark:hover:bg-white/10",
                  ].join(" ")}
                >
                  {d}d
                </Link>
              ))}
            </ChipGroup>
            <IconButton
              variant="secondary"
              aria-label="Catalog config"
              title="Catalog config"
              asChild
            >
              <Link href="/catalog/config" className="grid place-items-center">
                <List className="h-4 w-4" style={{ color: "var(--sb-text)" }} />
              </Link>
            </IconButton>
          </>
        }
      />

      <FilterBar
        left={
          <div className="flex items-center gap-2">
            <IconButton
              aria-label={isArtistExpanded ? "Collapse artist info" : "Expand artist info"}
              title={isArtistExpanded ? "Collapse artist info" : "Expand artist info"}
              variant="ghost"
              className="rounded"
              onClick={() => setIsArtistExpanded(!isArtistExpanded)}
            >
              <ChevronRight
                className={`h-3.5 w-3.5 transition-transform duration-200 ${isArtistExpanded ? "rotate-90" : ""}`}
              />
            </IconButton>
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
                          router.push(hrefWithPatchedSearchParams(sp, { artist_id: id, isrc: null }));
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
                          router.push(hrefWithPatchedSearchParams(sp, { isrc: isrc || null }));
                        }}
                        imageShape="square"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        }
      />

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
                  {props.artistName}
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
            overrideAnnotations={props.artistOverrideAnnotations}
          />

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="space-y-3">
              <div className="flex items-end justify-between px-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold">Top tracks (total)</h2>
                  <button
                    type="button"
                    onClick={() => downloadTopTracksAsCsv(
                      props.topByCumulative,
                      `top-tracks-total-${slugifyForFilename(props.artistName)}-${todayIsoDate()}.csv`,
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
              <GlassTable
                headers={[
                  "",
                  "Track",
                  "ISRC",
                  {
                    label: topTracksMode === "revenue" ? "Total revenue" : "Total streams",
                    align: "right",
                  },
                ]}
                maxBodyHeightClassName="max-h-56"
                bodyClassName="overflow-x-hidden"
              >
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
                      <div className="min-w-0">
                        <Link
                          href={hrefWithPatchedSearchParams(sp, { isrc: t.isrc })}
                          className="block truncate font-medium transition-colors sb-link-hover"
                        >
                          {t.name ?? t.isrc}
                        </Link>
                        {t.artistNames?.length ? (
                          <div className="mt-0.5 truncate text-xs" style={{ color: "var(--sb-muted)" }}>
                            <ArtistLinks
                              artistNames={t.artistNames}
                              artistIds={t.artistIds}
                              className="inline"
                            />
                          </div>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell mono className="text-xs opacity-40" style={{ color: "var(--sb-muted)" }}>
                      {t.isrc}
                    </TableCell>
                    <TableCell numeric className="font-medium" style={topTracksNumberStyle}>
                      {t.total === null
                        ? null
                        : topTracksMode === "revenue"
                          ? formatUsd(t.total * streamPayoutPerStreamUsd)
                          : formatInt(t.total)}
                    </TableCell>
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
              <GlassTable
                headers={[
                  "",
                  "Track",
                  "ISRC",
                  {
                    label: topTracksMode === "revenue" ? "Daily revenue" : "Daily streams",
                    align: "right",
                  },
                ]}
                maxBodyHeightClassName="max-h-56"
                bodyClassName="overflow-x-hidden"
              >
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
                      <div className="min-w-0">
                        <Link
                          href={hrefWithPatchedSearchParams(sp, { isrc: t.isrc })}
                          className="block truncate font-medium transition-colors sb-link-hover"
                        >
                          {t.name ?? t.isrc}
                        </Link>
                        {t.artistNames?.length ? (
                          <div className="mt-0.5 truncate text-xs" style={{ color: "var(--sb-muted)" }}>
                            <ArtistLinks
                              artistNames={t.artistNames}
                              artistIds={t.artistIds}
                              className="inline"
                            />
                          </div>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell mono className="text-xs opacity-40" style={{ color: "var(--sb-muted)" }}>
                      {t.isrc}
                    </TableCell>
                    <TableCell numeric className="font-medium" style={topTracksNumberStyle}>
                      {t.daily === null
                        ? null
                        : topTracksMode === "revenue"
                          ? `+${formatUsd(t.daily * streamPayoutPerStreamUsd)}`
                          : `+${formatInt(t.daily)}`}
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
                  {props.selectedTrack.name ?? props.isrc}
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
                    <ArtistLinks
                      artistNames={props.selectedTrack.artistNames}
                      artistIds={props.selectedTrack.artistIds}
                    />
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
            ? props.trackCumDesc.map((p) => ({ date: dataDateFromRunDate(p.date), value: p.value * streamPayoutPerStreamUsd }))
            : props.trackCumDesc.map((p) => ({ date: dataDateFromRunDate(p.date), value: p.value }));

          const dailySeries = trackMode === "revenue"
            ? props.trackDailyWithMaDesc.map((p) => ({
                date: dataDateFromRunDate(p.date),
                daily: p.daily * streamPayoutPerStreamUsd,
                ma7: p.ma7 == null ? p.ma7 : p.ma7 * streamPayoutPerStreamUsd,
              }))
            : props.trackDailyWithMaDesc.map((p) => ({
                date: dataDateFromRunDate(p.date),
                daily: p.daily,
                ma7: p.ma7,
              }));

          const trackOverrideAnnotations =
            trackMode === "revenue"
              ? props.trackOverrideAnnotations.map((a) => ({
                  ...a,
                  note: `${a.note} (applies to revenue via payout model)`,
                }))
              : props.trackOverrideAnnotations;

          const cumulativeTitle = trackMode === "revenue" ? "Track total revenue" : "Track total streams";
          const dailyTitle = trackMode === "revenue" ? "Track daily revenue" : "Track daily streams";
          const dailyLabel = trackMode === "revenue" ? "Daily revenue" : "Daily streams";
          const totalLabel = trackMode === "revenue" ? "Total revenue" : "Total streams";

          // Use emerald for revenue, accent stroke for streams (tracks don't have a separate mode like artist/playlist)
          const trackChartColor = trackMode === "revenue" ? "#10b981" : undefined;

          return (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
              <SpotlightCard className="lg:col-span-6 p-3 overflow-visible">
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
                    annotations={trackOverrideAnnotations}
                  />
                </div>
              </SpotlightCard>

              <SpotlightCard className="lg:col-span-6 p-3 overflow-visible">
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
                    annotations={trackOverrideAnnotations}
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
