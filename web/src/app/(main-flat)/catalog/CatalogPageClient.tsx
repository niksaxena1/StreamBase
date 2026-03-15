"use client";

import Image from "next/image";
import type { ReactNode } from "react";
import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ExternalLink, Download, List, ChevronRight, User } from "lucide-react";
import { formatDateISO, formatDateOrdinalDMonYYYY, formatInt, formatUsd } from "@/lib/format";
import { GlassTable, TableCell, TableRow, EmptyState } from "@/components/ui/GlassTable";
import { Combobox } from "@/components/ui/Combobox";
import { SpotlightCard } from "@/components/ui/SpotlightCard";
import { AnimatedCounter } from "@/components/ui/AnimatedCounter";
import { CatalogMetricsClient } from "./CatalogMetricsClient";
import { DailyStreamsChart } from "@/components/charts/DailyStreamsChart";
import { DailyStreamsWithMAChart } from "@/components/charts/DailyStreamsWithMAChart";
import { ChartCsvDownloadButton } from "@/components/charts/ChartCsvDownloadButton";
import { downloadCsv, slugifyForFilename, todayIsoDate } from "@/lib/csv";
import { dataDateFromRunDate } from "@/lib/sotDates";
import { ArtistLinks } from "@/components/ui/ArtistLinks";
import { PageHeader } from "@/components/shell/PageHeader";
import { hrefWithPatchedSearchParams } from "@/lib/searchParams";
import { FilterBar } from "@/components/ui/FilterBar";
import { IconButton } from "@/components/ui/Button";
import { usePayoutRate } from "@/components/payout/PayoutRateContext";
import { useMetric } from "@/components/metrics/MetricContext";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { RememberTrackSelection } from "@/components/dashboard/RememberTrackSelection";
import { GranularitySelect, RangeSelect, handleGranularityWithRangeRestore, granularityLabel } from "@/components/ui/GranularitySelect";
import type { Granularity } from "@/components/ui/GranularitySelect";
import { DateRangePicker, type DateRangePickerHandle } from "@/components/ui/DateRangePicker";
import { aggregateCumulativeSeries, aggregateDailySeries } from "@/lib/granularity";
import { useSharedGranularity } from "@/lib/useSharedGranularity";
import { useLongPress } from "@/components/charts/useLongPress";
import type { TrackSeriesPoint, TrackDailyPoint, SelectedTrack, TrackPlaylistMembership, TopTrack, ChartDataPoint, DailyDataPoint, ArtistOption, TrackOption } from "./catalogTypes";
import { sortTopTracks, toggleSort, type SortState, type TopSortKey } from "./catalogUtils";

// Defined at module level so its identity is stable across renders.
// Putting it inside the component would create a new type on every render,
// causing React to unmount and remount the sort header cells unnecessarily.
function SilentSortHeader({ label, onClick }: { label: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left select-none cursor-default uppercase"
      // Intentionally no hover/active styles: "hidden" power-user feature.
      style={{ color: "inherit" }}
    >
      {typeof label === "string" ? label.toUpperCase() : label}
    </button>
  );
}

export function CatalogPageClient(props: {
  latestCum: number;
  latestDate: string | null;
  latestDataDate?: string | null;
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
  selectedTrackPlaylistMemberships: TrackPlaylistMembership[];
}) {
  const { metric } = useMetric();
  const [isArtistExpanded, setIsArtistExpanded] = useState(true);
  const router = useRouter();
  const sp = useSearchParams();
  const { streamPayoutPerStreamUsd } = usePayoutRate();
  const [granularity, setGranularityRaw] = useSharedGranularity("sb:catalog:granularity");
  const datePickerRef = useRef<DateRangePickerHandle>(null);
  const hasCustomRange = Boolean(sp?.get("start") && sp?.get("end"));
  const pushRange = useCallback(
    (range: number) => router.push(hrefWithPatchedSearchParams(sp, { range: String(range), start: null, end: null })),
    [router, sp],
  );
  const handleGranularityChange = useCallback(
    (g: Granularity) =>
      handleGranularityWithRangeRestore(g, props.rangeDays, "catalog", setGranularityRaw, pushRange),
    [props.rangeDays, setGranularityRaw, pushRange],
  );

  useEffect(() => {
    if (props.isrc) {
      try {
        localStorage.setItem("sb:last_catalog_track_isrc", props.isrc);
      } catch {}
    }
  }, [props.isrc]);

  // Pre-compute track chart series data. This is O(n) over the time series length
  // (which grows daily), so memoize to avoid re-running on unrelated state changes.
  const trackChartData = useMemo(() => {
    if (!props.isrc) return null;
    // For track panels, "Tracks" metric doesn't apply (always 1 track), so treat as streams.
    const trackMode: "revenue" | "streams" = metric === "revenue" ? "revenue" : "streams";
    const valueFormat = trackMode === "revenue" ? ("usd" as const) : ("int" as const);
    const yTickFormat = trackMode === "revenue" ? ("usd_compact" as const) : ("k" as const);

    const cumSeriesRaw = trackMode === "revenue"
      ? props.trackCumDesc.map((p) => ({ date: dataDateFromRunDate(p.date), value: p.value * streamPayoutPerStreamUsd }))
      : props.trackCumDesc.map((p) => ({ date: dataDateFromRunDate(p.date), value: p.value }));
    const cumSeries = aggregateCumulativeSeries(cumSeriesRaw, granularity);

    const dailySeriesRaw = trackMode === "revenue"
      ? props.trackDailyWithMaDesc.map((p) => ({
          date: dataDateFromRunDate(p.date),
          daily: p.daily == null ? null : p.daily * streamPayoutPerStreamUsd,
          ma7: p.ma7 == null ? p.ma7 : p.ma7 * streamPayoutPerStreamUsd,
        }))
      : props.trackDailyWithMaDesc.map((p) => ({
          date: dataDateFromRunDate(p.date),
          daily: p.daily,
          ma7: p.ma7,
        }));
    const dailySeries = granularity === "daily"
      ? dailySeriesRaw
      : aggregateDailySeries(dailySeriesRaw, granularity);

    const trackOverrideAnnotations =
      trackMode === "revenue"
        ? props.trackOverrideAnnotations.map((a) => ({
            ...a,
            note: `${a.note} (applies to revenue via payout model)`,
          }))
        : props.trackOverrideAnnotations;

    const glTrack = granularityLabel(granularity).toLowerCase();
    const trackChartColor = trackMode === "revenue" ? "#10b981" : undefined;

    return {
      trackMode,
      valueFormat,
      yTickFormat,
      cumSeries,
      dailySeries,
      trackOverrideAnnotations,
      cumulativeTitle: trackMode === "revenue" ? "Track total revenue" : "Track total streams",
      dailyTitle: trackMode === "revenue" ? `Track ${glTrack} revenue` : `Track ${glTrack} streams`,
      dailyLabel: trackMode === "revenue" ? `${granularityLabel(granularity)} revenue` : `${granularityLabel(granularity)} streams`,
      totalLabel: trackMode === "revenue" ? "Total revenue" : "Total streams",
      trackChartColor,
    };
  }, [props.isrc, props.trackCumDesc, props.trackDailyWithMaDesc, metric, granularity, streamPayoutPerStreamUsd, props.trackOverrideAnnotations]);

  // Top-track tables only make sense for streams/revenue; treat "tracks" as streams.
  const topTracksMode: "streams" | "revenue" = metric === "revenue" ? "revenue" : "streams";
  const topTracksNumberStyle =
    topTracksMode === "revenue"
      ? ({ color: "#10b981" } as const) // emerald-500
      : ({ color: "var(--sb-positive)" } as const);

  type TopSortKey = "name" | "release" | "total" | "daily";
  type SortState = { key: TopSortKey; asc: boolean } | null;

  const [topTotalSort, setTopTotalSort] = useState<SortState>(null);
  const [topDailySort, setTopDailySort] = useState<SortState>(null);


  const topByCumulativeSorted = useMemo(
    () => sortTopTracks(props.topByCumulative, topTotalSort, "total"),
    [props.topByCumulative, topTotalSort],
  );
  const topByDailySorted = useMemo(
    () => sortTopTracks(props.topByDaily, topDailySort, "daily"),
    [props.topByDaily, topDailySort],
  );

  // Concentration analysis — N tracks = 50% of streams
  const concentrationTotal = useMemo(() => {
    const sorted = [...props.topByCumulative].sort((a, b) => (b.total ?? 0) - (a.total ?? 0));
    const grandTotal = sorted.reduce((s, t) => s + (t.total ?? 0), 0);
    if (!grandTotal) return { grandTotal: 0, nThreshold: 0, pctByIsrc: new Map<string, number>(), thresholdIsrc: null as string | null };
    let cum = 0;
    let nThreshold = 0;
    let thresholdIsrc: string | null = null;
    const pctByIsrc = new Map<string, number>();
    for (const t of sorted) {
      const pct = ((t.total ?? 0) / grandTotal) * 100;
      pctByIsrc.set(t.isrc, pct);
      cum += pct;
      nThreshold++;
      if (cum >= 50 && !thresholdIsrc) thresholdIsrc = t.isrc;
    }
    return { grandTotal, nThreshold, pctByIsrc, thresholdIsrc };
  }, [props.topByCumulative]);

  const concentrationDaily = useMemo(() => {
    const sorted = [...props.topByDaily].sort((a, b) => (b.daily ?? 0) - (a.daily ?? 0));
    const grandTotal = sorted.reduce((s, t) => s + (t.daily ?? 0), 0);
    if (!grandTotal) return { grandTotal: 0, nThreshold: 0, pctByIsrc: new Map<string, number>(), thresholdIsrc: null as string | null };
    let cum = 0;
    let nThreshold = 0;
    let thresholdIsrc: string | null = null;
    const pctByIsrc = new Map<string, number>();
    for (const t of sorted) {
      const pct = ((t.daily ?? 0) / grandTotal) * 100;
      pctByIsrc.set(t.isrc, pct);
      cum += pct;
      nThreshold++;
      if (cum >= 50 && !thresholdIsrc) thresholdIsrc = t.isrc;
    }
    return { grandTotal, nThreshold, pctByIsrc, thresholdIsrc };
  }, [props.topByDaily]);

  // Memoize Combobox options so inline `.map()` calls don't produce new array
  // references on every render, which would invalidate the Combobox's internal
  // filtered useMemo even when the underlying data hasn't changed.
  const artistComboboxOptions = useMemo(
    () => props.artists.map((a) => ({ value: a.id, label: a.name, imageUrl: a.imageUrl })),
    [props.artists],
  );
  const trackComboboxOptions = useMemo(
    () => props.tracks.map((t) => ({ value: t.isrc, label: t.name, imageUrl: t.albumImageUrl })),
    [props.tracks],
  );

  // Pre-compute per-row hrefs for the top-track tables so hrefWithPatchedSearchParams
  // (which parses/serializes URL params) isn't called for every row on every render.
  const topCumulativeHrefs = useMemo(
    () => new Map(topByCumulativeSorted.map((t) => [t.isrc, hrefWithPatchedSearchParams(sp, { isrc: t.isrc })])),
    [topByCumulativeSorted, sp],
  );
  const topDailyHrefs = useMemo(
    () => new Map(topByDailySorted.map((t) => [t.isrc, hrefWithPatchedSearchParams(sp, { isrc: t.isrc })])),
    [topByDailySorted, sp],
  );

  // On mobile, ISRC column is hidden and the Release column toggles
  // between Release date and ISRC via long press.
  const [showIsrcOnMobile, setShowIsrcOnMobile] = useState(false);
  const lpFiredRef = useRef(false);

  const toggleIsrcRelease = useCallback(() => {
    setShowIsrcOnMobile((prev) => !prev);
    lpFiredRef.current = true;
  }, []);

  const {
    onPointerDown: releaseLpDown,
    onPointerMove: releaseLpMove,
    onPointerUp: releaseLpUp,
    onPointerCancel: releaseLpCancel,
  } = useLongPress({ onLongPress: toggleIsrcRelease });

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
      <RememberTrackSelection artistId={props.artistId} hasTrack={!!props.isrc} />
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
            {granularity === "daily" && (
              <>
                <RangeSelect
                  value={props.rangeDays}
                  onChange={pushRange}
                  onCustom={() => datePickerRef.current?.open()}
                  customActive={hasCustomRange}
                  customStart={sp?.get("start") ?? null}
                  customEnd={sp?.get("end") ?? null}
                />
                <DateRangePicker ref={datePickerRef} latestDate={props.latestDataDate ?? null} currentRangeDays={props.rangeDays} headless />
              </>
            )}
            <GranularitySelect value={granularity} onChange={handleGranularityChange} />
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
                        options={artistComboboxOptions}
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
                        options={trackComboboxOptions}
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
        className={`transition-all duration-300 ease-in-out ${
          isArtistExpanded
            ? "overflow-visible max-h-[5000px] opacity-100"
            : "overflow-hidden max-h-0 opacity-0"
        }`}
      >
        <div className="space-y-4 pt-2">
          <div className="flex items-center gap-4">
            {props.artistImageUrl ? (
              <Image
                src={props.artistImageUrl}
                alt={props.artistName}
                width={64}
                height={64}
                className="rounded-full object-cover sb-ring"
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
            granularity={granularity}
          />

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="space-y-3">
              <div className="flex items-end justify-between px-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold">Tracks (total)</h2>
                  <button
                    type="button"
                    onClick={() => downloadTopTracksAsCsv(
                      topByCumulativeSorted,
                      `tracks-total-${slugifyForFilename(props.artistName)}-${todayIsoDate()}.csv`,
                      false
                    )}
                    className="inline-flex items-center justify-center p-0 transition-colors hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                    title="Download as CSV"
                    style={{ color: "var(--sb-muted)" }}
                  >
                    <Download className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="text-[11px] text-right" style={{ color: "var(--sb-muted)" }}>
                  {props.topByCumulative.length} tracks
                  {concentrationTotal.nThreshold > 0 && concentrationTotal.nThreshold < props.topByCumulative.length && (
                    <> · top {concentrationTotal.nThreshold} = 50%</>
                  )}
                </div>
              </div>
              <GlassTable
                headers={[
                  "",
                  {
                    label: (
                      <SilentSortHeader
                        label="TRACK"
                        onClick={() => toggleSort(setTopTotalSort, topTotalSort, "name")}
                      />
                    ),
                  },
                  { label: "ISRC", className: "hidden sm:table-cell" },
                  {
                    label: (
                      <div
                        onPointerDown={releaseLpDown}
                        onPointerMove={releaseLpMove}
                        onPointerUp={releaseLpUp}
                        onPointerCancel={releaseLpCancel}
                      >
                        <SilentSortHeader
                          label={
                            <>
                              <span className="sm:hidden">{showIsrcOnMobile ? "ISRC" : "RELEASE"}</span>
                              <span className="hidden sm:inline">RELEASE</span>
                            </>
                          }
                          onClick={() => {
                            if (lpFiredRef.current) { lpFiredRef.current = false; return; }
                            toggleSort(setTopTotalSort, topTotalSort, "release");
                          }}
                        />
                      </div>
                    ),
                  },
                  {
                    label: (
                      <SilentSortHeader
                        label={topTracksMode === "revenue" ? "TOTAL REVENUE" : "TOTAL STREAMS"}
                        onClick={() => toggleSort(setTopTotalSort, topTotalSort, "total")}
                      />
                    ),
                    align: "right",
                  },
                  { label: "SHARE", align: "right" },
                ]}
                maxBodyHeightClassName="max-h-56"
                bodyClassName="overflow-x-hidden"
              >
                {topByCumulativeSorted.map((t, i) => {
                  const isThreshold = t.isrc === concentrationTotal.thresholdIsrc;
                  const pct = concentrationTotal.pctByIsrc.get(t.isrc);
                  return (
                    <>
                      <TableRow key={t.isrc}>
                        <TableCell>
                          {t.albumImageUrl ? (
                            <Image
                              src={t.albumImageUrl}
                              alt="Album cover"
                              width={32}
                              height={32}
                              className="rounded-lg object-cover sb-ring"
                            />
                          ) : (
                            <div className="h-8 w-8 rounded-lg sb-ring bg-white/60" />
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="min-w-0">
                            <Link
                              href={topCumulativeHrefs.get(t.isrc) ?? "#"}
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
                        <TableCell mono className="text-xs opacity-40 hidden sm:table-cell" style={{ color: "var(--sb-muted)" }}>
                          {t.isrc}
                        </TableCell>
                        <TableCell mono className="text-xs" style={{ color: "var(--sb-muted)" }}>
                          {showIsrcOnMobile ? t.isrc : (t.releaseDate ? formatDateISO(t.releaseDate) : null)}
                        </TableCell>
                        <TableCell numeric className="font-medium" style={topTracksNumberStyle}>
                          {t.total === null
                            ? null
                            : topTracksMode === "revenue"
                              ? formatUsd(t.total * streamPayoutPerStreamUsd)
                              : formatInt(t.total)}
                        </TableCell>
                        <TableCell numeric className="text-xs font-mono" style={{ color: "var(--sb-muted)", opacity: 0.7 }}>
                          {pct != null ? `${pct.toFixed(1)}%` : null}
                        </TableCell>
                      </TableRow>
                      {isThreshold && (
                        <tr key={`${t.isrc}-divider`} aria-hidden>
                          <td colSpan={6} className="px-2 py-0">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 border-t" style={{ borderColor: "var(--sb-positive)", opacity: 0.4 }} />
                              <span className="text-[10px] font-medium" style={{ color: "var(--sb-positive)", opacity: 0.7 }}>50% of streams above</span>
                              <div className="flex-1 border-t" style={{ borderColor: "var(--sb-positive)", opacity: 0.4 }} />
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
                {!props.topByCumulative.length && (
                  <EmptyState colSpan={6} message="No track totals found" />
                )}
              </GlassTable>
            </div>

            <div className="space-y-3">
              <div className="flex items-end justify-between px-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold">Tracks (daily)</h2>
                  <button
                    type="button"
                    onClick={() => downloadTopTracksAsCsv(
                      topByDailySorted,
                      `tracks-daily-${slugifyForFilename(props.artistName)}-${todayIsoDate()}.csv`,
                      true
                    )}
                    className="inline-flex items-center justify-center p-0 transition-colors hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                    title="Download as CSV"
                    style={{ color: "var(--sb-muted)" }}
                  >
                    <Download className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="text-[11px] text-right" style={{ color: "var(--sb-muted)" }}>
                  {props.topByDaily.length} tracks
                  {concentrationDaily.nThreshold > 0 && concentrationDaily.nThreshold < props.topByDaily.length && (
                    <> · top {concentrationDaily.nThreshold} = 50%</>
                  )}
                </div>
              </div>
              <GlassTable
                headers={[
                  "",
                  {
                    label: (
                      <SilentSortHeader
                        label="TRACK"
                        onClick={() => toggleSort(setTopDailySort, topDailySort, "name")}
                      />
                    ),
                  },
                  { label: "ISRC", className: "hidden sm:table-cell" },
                  {
                    label: (
                      <div
                        onPointerDown={releaseLpDown}
                        onPointerMove={releaseLpMove}
                        onPointerUp={releaseLpUp}
                        onPointerCancel={releaseLpCancel}
                      >
                        <SilentSortHeader
                          label={
                            <>
                              <span className="sm:hidden">{showIsrcOnMobile ? "ISRC" : "RELEASE"}</span>
                              <span className="hidden sm:inline">RELEASE</span>
                            </>
                          }
                          onClick={() => {
                            if (lpFiredRef.current) { lpFiredRef.current = false; return; }
                            toggleSort(setTopDailySort, topDailySort, "release");
                          }}
                        />
                      </div>
                    ),
                  },
                  {
                    label: (
                      <SilentSortHeader
                        label={topTracksMode === "revenue" ? "DAILY REVENUE" : "DAILY STREAMS"}
                        onClick={() => toggleSort(setTopDailySort, topDailySort, "daily")}
                      />
                    ),
                    align: "right",
                  },
                  { label: "SHARE", align: "right" },
                ]}
                maxBodyHeightClassName="max-h-56"
                bodyClassName="overflow-x-hidden"
              >
                {topByDailySorted.map((t) => {
                  const isThreshold = t.isrc === concentrationDaily.thresholdIsrc;
                  const pct = concentrationDaily.pctByIsrc.get(t.isrc);
                  return (
                    <>
                      <TableRow key={t.isrc}>
                        <TableCell>
                          {t.albumImageUrl ? (
                            <Image
                              src={t.albumImageUrl}
                              alt="Album cover"
                              width={32}
                              height={32}
                              className="rounded-lg object-cover sb-ring"
                            />
                          ) : (
                            <div className="h-8 w-8 rounded-lg sb-ring bg-white/60" />
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="min-w-0">
                            <Link
                              href={topDailyHrefs.get(t.isrc) ?? "#"}
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
                        <TableCell mono className="text-xs opacity-40 hidden sm:table-cell" style={{ color: "var(--sb-muted)" }}>
                          {t.isrc}
                        </TableCell>
                        <TableCell mono className="text-xs" style={{ color: "var(--sb-muted)" }}>
                          {showIsrcOnMobile ? t.isrc : (t.releaseDate ? formatDateISO(t.releaseDate) : null)}
                        </TableCell>
                        <TableCell numeric className="font-medium" style={topTracksNumberStyle}>
                          {t.daily === null
                            ? null
                            : topTracksMode === "revenue"
                              ? `+${formatUsd(t.daily * streamPayoutPerStreamUsd)}`
                              : `+${formatInt(t.daily)}`}
                        </TableCell>
                        <TableCell numeric className="text-xs font-mono" style={{ color: "var(--sb-muted)", opacity: 0.7 }}>
                          {pct != null ? `${pct.toFixed(1)}%` : null}
                        </TableCell>
                      </TableRow>
                      {isThreshold && (
                        <tr key={`${t.isrc}-divider`} aria-hidden>
                          <td colSpan={6} className="px-2 py-0">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 border-t" style={{ borderColor: "var(--sb-positive)", opacity: 0.4 }} />
                              <span className="text-[10px] font-medium" style={{ color: "var(--sb-positive)", opacity: 0.7 }}>50% of streams above</span>
                              <div className="flex-1 border-t" style={{ borderColor: "var(--sb-positive)", opacity: 0.4 }} />
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
                {!props.topByDaily.length && (
                  <EmptyState colSpan={6} message="No daily deltas found" />
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
              <Image
                src={props.selectedTrack.albumImageUrl}
                alt="Album cover"
                width={64}
                height={64}
                className="rounded-lg object-cover sb-ring"
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
                {props.selectedTrack.releaseDate ? (
                  <>
                    <span>
                      Released:{" "}
                      <span className="font-medium">
                        {formatDateOrdinalDMonYYYY(props.selectedTrack.releaseDate)}
                      </span>
                    </span>
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

        {trackChartData ? (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
            <SpotlightCard className="lg:col-span-6 p-3 overflow-visible">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-wider opacity-60">
                    {trackChartData.cumulativeTitle}
                  </div>
                  <div className="mt-1 font-display text-3xl font-bold tracking-tight">
                    {trackChartData.cumSeries.length > 0 ? (
                      <AnimatedCounter value={trackChartData.cumSeries[trackChartData.cumSeries.length - 1]?.value ?? 0} format={trackChartData.valueFormat} />
                    ) : (
                      "â€”"
                    )}
                  </div>
                </div>
                <ChartCsvDownloadButton
                  rows={trackChartData.cumSeries as unknown as Array<Record<string, unknown>>}
                  filename={`catalog-track-${slugifyForFilename(trackChartData.cumulativeTitle)}-${props.rangeDays}d-${todayIsoDate()}.csv`}
                  title="Download CSV"
                />
              </div>
              <div className="mt-2 min-h-[180px]">
                <DailyStreamsChart
                  data={trackChartData.cumSeries}
                  valueLabel={trackChartData.totalLabel}
                  valueFormat={trackChartData.valueFormat}
                  yTickFormat={trackChartData.yTickFormat}
                  heightPx={220}
                  isCumulative={true}
                  color={trackChartData.trackChartColor}
                  annotations={trackChartData.trackOverrideAnnotations}
                />
              </div>
            </SpotlightCard>

            <SpotlightCard className="lg:col-span-6 p-3 overflow-visible">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-wider opacity-60">
                    {trackChartData.dailyTitle}
                  </div>
                  <div className="mt-1 font-display text-3xl font-bold tracking-tight">
                    {trackChartData.dailySeries.length > 0 && trackChartData.dailySeries[0]?.daily != null ? (
                      <AnimatedCounter value={Math.abs(trackChartData.dailySeries[0]?.daily ?? 0)} format={trackChartData.valueFormat} />
                    ) : (
                      "â€”"
                    )}
                  </div>
                </div>
                <ChartCsvDownloadButton
                  rows={trackChartData.dailySeries as unknown as Array<Record<string, unknown>>}
                  filename={`catalog-track-${slugifyForFilename(trackChartData.dailyTitle)}-${props.rangeDays}d-${todayIsoDate()}.csv`}
                  title="Download CSV"
                />
              </div>
              <div className="mt-2 min-h-[180px]">
                <DailyStreamsWithMAChart
                  data={trackChartData.dailySeries}
                  valueLabel={trackChartData.dailyLabel}
                  valueFormat={trackChartData.valueFormat}
                  yTickFormat={trackChartData.yTickFormat}
                  heightPx={220}
                  dailyColor={trackChartData.trackChartColor}
                  annotations={trackChartData.trackOverrideAnnotations}
                />
              </div>
            </SpotlightCard>
          </div>
        ) : null}
      </div>

      {/* Track playlist memberships (last section) */}
      <div className="space-y-2 pt-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Playlist memberships</h2>
          <div className="text-xs text-right" style={{ color: "var(--sb-muted)" }}>
            {props.isrc
              ? "Playlists this track has been in (as of the latest data date)"
              : "Pick a track to see playlist memberships"}
          </div>
        </div>

        <GlassTable headers={["", "PLAYLIST", { label: "KEY", className: "hidden sm:table-cell" }, "TYPE", "ADDED", "REMOVED"]} maxBodyHeightClassName="max-h-80">
          {(props.isrc ? props.selectedTrackPlaylistMemberships : []).map((m) => (
            <TableRow key={m.playlistKey}>
              <TableCell>
                {m.spotifyPlaylistImageUrl ? (
                  <Image
                    src={m.spotifyPlaylistImageUrl}
                    alt="Playlist cover"
                    width={32}
                    height={32}
                    className="rounded-lg object-cover sb-ring"
                  />
                ) : (
                  <div className="h-8 w-8 rounded-lg sb-ring bg-white/60" />
                )}
              </TableCell>
              <TableCell>
                <div className="min-w-0">
                  <Link
                    href={`/playlists?playlist_key=${encodeURIComponent(String(m.playlistKey))}`}
                    className="block truncate font-medium transition-colors sb-link-hover"
                  >
                    {m.playlistName}
                  </Link>
                </div>
              </TableCell>
              <TableCell mono className="text-[11px] opacity-60 hidden sm:table-cell" style={{ color: "var(--sb-muted)" }}>
                {m.playlistKey}
              </TableCell>
              <TableCell>
                {(() => {
                  const type = (m.playlistType ?? "").trim() || "Standard";
                  if (type === "Catalog") {
                    return (
                      <span
                        className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
                        style={{ background: "var(--sb-accent-10)", color: "var(--sb-positive)" }}
                      >
                        Catalog
                      </span>
                    );
                  }
                  const typeColors = {
                    Label: {
                      bg: "bg-blue-400/20",
                      text: "text-blue-800 dark:text-blue-300",
                    },
                    Entity: {
                      bg: "bg-purple-400/20",
                      text: "text-purple-800 dark:text-purple-300",
                    },
                    Distro: {
                      bg: "bg-orange-400/20",
                      text: "text-orange-800 dark:text-orange-300",
                    },
                  } as const;
                  const colors =
                    (typeColors as Record<string, { bg: string; text: string }>)[type] || {
                      bg: "bg-black/10",
                      text: "text-black/80 dark:text-white/60",
                    };
                  return (
                    <span
                      className={`inline-flex items-center rounded-full ${colors.bg} px-2.5 py-0.5 text-xs font-medium ${colors.text}`}
                    >
                      {type}
                    </span>
                  );
                })()}
              </TableCell>
              <TableCell mono className="text-[11px]">
                {formatDateISO(dataDateFromRunDate(m.addedRunDate))}
              </TableCell>
              <TableCell mono className="text-[11px]">
                {m.removedRunDate ? formatDateISO(dataDateFromRunDate(m.removedRunDate)) : "—"}
              </TableCell>
            </TableRow>
          ))}

          {props.isrc && !props.selectedTrackPlaylistMemberships.length ? (
            <EmptyState colSpan={6} message="No playlist memberships found for this track." />
          ) : null}
          {!props.isrc ? <EmptyState colSpan={6} message="Select a track to see memberships." /> : null}
        </GlassTable>
      </div>
    </>
  );
}
