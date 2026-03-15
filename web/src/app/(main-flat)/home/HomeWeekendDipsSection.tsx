"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { X } from "lucide-react";
import { useMetric } from "@/components/metrics/MetricContext";
import { useWeekendDip } from "@/components/charts/WeekendDipContext";
import { GlassTable, TableCell, TableRow, EmptyState } from "@/components/ui/GlassTable";
import { formatInt, formatUsd } from "@/lib/format";
import { usePayoutRate } from "@/components/payout/PayoutRateContext";
import type { ArtistWeekendDipRow, TrackWeekendDipRow } from "./homeTypes";
import { readStoredBool, readStoredNumber, writeStoredBool, writeStoredNumber } from "@/lib/storage";
import { ChartCsvDownloadButton } from "@/components/charts/ChartCsvDownloadButton";
import { todayIsoDate } from "@/lib/csv";

const STORAGE_KEY_OPEN = "sb:home-weekend-dips-open";
const STORAGE_KEY_MIN_AVG = "sb:home-weekend-dips-min-avg";
const STORAGE_KEY_VIEW = "sb:home-weekend-dips-view";

type SortKey = "track_count" | "weekday_avg" | "sat_dip_pct" | "sun_dip_pct" | "avg_dip_pct";
type ViewMode = "artists" | "tracks";

function dipColor(pct: number | null): React.CSSProperties {
  if (pct == null) return { color: "var(--sb-muted)" };
  if (pct <= -15) return { color: "#ef4444" }; // red-500
  if (pct <= -5) return { color: "#f97316" };  // orange-500
  if (pct >= 5) return { color: "#22c55e" };   // green-500
  return { color: "var(--sb-muted)" };
}

function formatDip(pct: number | null): string {
  if (pct == null) return "—";
  return `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

export function HomeWeekendDipsSection(props: {
  artistWeekendDips: ArtistWeekendDipRow[];
  trackWeekendDips: TrackWeekendDipRow[];
}) {
  const { metric } = useMetric();
  const { showWeekendDip } = useWeekendDip();
  const { streamPayoutPerStreamUsd } = usePayoutRate();
  const [minWeekdayAvg, setMinWeekdayAvg] = useState(0);
  const [open, setOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("artists");
  const [sortKey, setSortKey] = useState<SortKey>("avg_dip_pct");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Restore persisted state
  useEffect(() => {
    setOpen(readStoredBool(STORAGE_KEY_OPEN, false));
    setMinWeekdayAvg(readStoredNumber(STORAGE_KEY_MIN_AVG, 0));
    const v = (typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY_VIEW) : null) ?? null;
    if (v === "tracks" || v === "artists") setViewMode(v);
  }, []);

  useEffect(() => { writeStoredBool(STORAGE_KEY_OPEN, open); }, [open]);
  useEffect(() => { writeStoredNumber(STORAGE_KEY_MIN_AVG, minWeekdayAvg); }, [minWeekdayAvg]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY_VIEW, viewMode); } catch { /* ignore */ }
    if (viewMode === "tracks" && sortKey === "track_count") {
      setSortKey("avg_dip_pct");
      setSortDir("asc");
    }
  }, [viewMode, sortDir, sortKey]);

  function toggleSort(nextKey: SortKey) {
    if (nextKey === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDir(nextKey === "track_count" || nextKey === "weekday_avg" ? "desc" : "asc");
  }

  function sortIndicator(key: SortKey) {
    if (key !== sortKey) return null;
    return <span className="ml-1 opacity-60">{sortDir === "asc" ? "▲" : "▼"}</span>;
  }

  const filtered = useMemo(() => {
    const base =
      viewMode === "tracks"
        ? (props.trackWeekendDips ?? []).filter((t) => Number(t.weekday_avg ?? 0) >= minWeekdayAvg)
        : (props.artistWeekendDips ?? []).filter((a) => Number(a.weekday_avg ?? 0) >= minWeekdayAvg);

    const get = (row: ArtistWeekendDipRow | TrackWeekendDipRow): number => {
      const raw =
        sortKey === "track_count"
          ? Number((row as ArtistWeekendDipRow).track_count ?? 0)
          : sortKey === "weekday_avg"
            ? Number(row.weekday_avg ?? 0)
            : Number((row as Record<string, unknown>)[sortKey] ?? 0);
      return Number.isFinite(raw) ? raw : 0;
    };

    return [...base].sort((a, b) => {
      const cmp = get(a) - get(b);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [props.artistWeekendDips, props.trackWeekendDips, minWeekdayAvg, sortKey, sortDir, viewMode]);

  if (!showWeekendDip || metric === "tracks") return null;

  const metricValueClass = metric === "revenue" ? "font-medium" : "sb-positive font-medium";
  const metricValueStyle = metric === "revenue" ? ({ color: "#10b981" } as const) : undefined;
  const formatMetricValue = (weekdayAvgStreams: number) => {
    if (metric === "revenue") return formatUsd(weekdayAvgStreams * streamPayoutPerStreamUsd);
    return formatInt(Math.round(weekdayAvgStreams));
  };

  const headerPill = (active: boolean) =>
    [
      "rounded-full px-2.5 py-1.5 text-[11px] font-medium transition",
      active
        ? "bg-black text-white dark:bg-white dark:text-black"
        : "text-black/70 hover:bg-white/70 dark:text-white/70 dark:hover:bg-white/20",
    ].join(" ");

  const sectionTitle = viewMode === "tracks" ? "TRACKS WEEKEND DIP" : "ARTISTS WEEKEND DIP";
  const sectionSubtitle =
    viewMode === "tracks"
      ? "Latest week: tracks ranked by Sat & Sun vs Mon–Fri average"
      : "Latest week: artists ranked by Sat & Sun vs Mon–Fri average";

  // Collapsed summary: count + worst avg dip
  const worstAvgDip = filtered.length > 0
    ? Math.min(...filtered.map((r) => Number(r.avg_dip_pct ?? 0)))
    : null;
  const collapsedSummary = filtered.length > 0
    ? `${filtered.length} ${viewMode === "tracks" ? "tracks" : "artists"}${worstAvgDip != null && worstAvgDip < 0 ? ` · worst avg: ${worstAvgDip.toFixed(1)}%` : ""}`
    : null;

  return (
    <details
      open={open}
      onToggle={(ev) => setOpen(ev.currentTarget.open)}
      className="rounded-xl border sb-panel p-3"
      style={{ borderColor: "var(--sb-border)" }}
    >
      <summary className="cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2 min-w-0">
            <span
              className="mt-0.5 flex-shrink-0 text-xs opacity-60 transition-transform duration-150"
              style={{ display: "inline-block", transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
            >
              ▸
            </span>
            <div className="min-w-0">
              <div className="text-[11px] font-medium uppercase tracking-wider opacity-60">
                {sectionTitle}
              </div>
              {open ? (
                <div className="mt-0.5 text-[10px] opacity-40">{sectionSubtitle}</div>
              ) : null}
            </div>
          </div>

          {/* Right: controls — only visible when expanded */}
          {open && <div
            className="flex items-center gap-2 flex-shrink-0"
            onMouseDown={(ev) => ev.stopPropagation()}
            onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); }}
          >
          <div className="sb-ring flex items-center gap-0.5 rounded-full bg-white/60 p-0.5 dark:bg-white/10">
            <button type="button" onClick={() => setViewMode("artists")} className={headerPill(viewMode === "artists")}>
              ARTISTS
            </button>
            <button type="button" onClick={() => setViewMode("tracks")} className={headerPill(viewMode === "tracks")}>
              TRACKS
            </button>
          </div>

          {/* Min average filter */}
          <div className="relative flex items-center">
            <input
              type="number"
              min="0"
              step="100"
              value={minWeekdayAvg || ""}
              onChange={(e) => setMinWeekdayAvg(Math.max(0, parseInt(e.currentTarget.value, 10) || 0))}
              placeholder="Min WD avg"
              className={[
                "text-xs pl-2 pr-6 py-1 rounded w-24",
                "bg-white/20 dark:bg-white/10",
                "border border-white/10",
                "outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0",
              ].join(" ")}
              style={{ color: "var(--sb-text)" }}
              title="Minimum weekday average (Mon–Fri) streams required to include an entry. Helps filter small/noisy data."
              aria-label="Minimum weekday average streams filter"
            />
            {minWeekdayAvg > 0 && (
              <button
                type="button"
                onClick={() => setMinWeekdayAvg(0)}
                className="absolute right-1.5 flex items-center justify-center opacity-40 hover:opacity-80 transition-opacity"
                title="Clear filter"
                aria-label="Clear minimum average filter"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          <ChartCsvDownloadButton
            filename={`home-weekend-dips-${viewMode}-${todayIsoDate()}.csv`}
            rows={(filtered as Array<Record<string, unknown>>)}
            title="Download weekend dips CSV"
          />
          </div>}
        </div>
      </summary>

      {/* Collapsible body */}
      {open && (
        <div className="mt-3">
          <GlassTable
            headers={[
              viewMode === "tracks" ? "TRACK" : "ARTIST",
              ...(viewMode === "artists"
                ? [{
                    label: (
                      <button type="button" className="sb-link-hover" onClick={() => toggleSort("track_count")}>
                        TRACKS{sortIndicator("track_count")}
                      </button>
                    ),
                    align: "right" as const,
                  }]
                : []),
              {
                label: (
                  <button type="button" className="sb-link-hover" onClick={() => toggleSort("weekday_avg")}>
                    WD AVG{sortIndicator("weekday_avg")}
                  </button>
                ),
                align: "right" as const,
              },
              {
                label: (
                  <button type="button" className="sb-link-hover" onClick={() => toggleSort("sat_dip_pct")}>
                    SAT %{sortIndicator("sat_dip_pct")}
                  </button>
                ),
                align: "right" as const,
              },
              {
                label: (
                  <button type="button" className="sb-link-hover" onClick={() => toggleSort("sun_dip_pct")}>
                    SUN %{sortIndicator("sun_dip_pct")}
                  </button>
                ),
                align: "right" as const,
              },
              {
                label: (
                  <button type="button" className="sb-link-hover" onClick={() => toggleSort("avg_dip_pct")}>
                    AVG %{sortIndicator("avg_dip_pct")}
                  </button>
                ),
                align: "right" as const,
              },
            ]}
            maxBodyHeightClassName="max-h-[600px]"
          >
            {filtered.length === 0 ? (
              <EmptyState colSpan={viewMode === "tracks" ? 5 : 6} message={viewMode === "tracks" ? "No tracks found" : "No artists found"} />
            ) : (
              viewMode === "tracks"
                ? (filtered as TrackWeekendDipRow[]).map((t) => (
                    <TableRow key={t.isrc}>
                      <TableCell>
                        <div className="flex items-center gap-2 min-w-0">
                          {t.album_image_url ? (
                            <Image
                              src={t.album_image_url}
                              alt={t.name ?? t.isrc}
                              width={28}
                              height={28}
                              className="h-7 w-7 rounded-lg object-cover sb-ring flex-shrink-0"
                            />
                          ) : (
                            <div className="h-7 w-7 rounded-lg sb-ring bg-white/60 dark:bg-white/10 flex-shrink-0" />
                          )}
                          <div className="min-w-0">
                            <Link
                              href={`/catalog?isrc=${encodeURIComponent(t.isrc)}`}
                              className="font-medium transition-colors sb-link-hover block truncate"
                            >
                              {t.name ?? t.isrc}
                            </Link>
                            <div className="text-[10px] opacity-50 truncate">
                              {(t.artist_name ?? "—")}{t.isrc ? ` · ${t.isrc}` : ""}
                            </div>
                          </div>
                        </div>
                      </TableCell>

                      <TableCell numeric className={metricValueClass} style={metricValueStyle}>
                        {formatMetricValue(Number(t.weekday_avg ?? 0))}
                      </TableCell>

                      <TableCell numeric className="font-semibold" style={dipColor(t.sat_dip_pct)}>
                        {formatDip(t.sat_dip_pct)}
                      </TableCell>

                      <TableCell numeric className="font-semibold" style={dipColor(t.sun_dip_pct)}>
                        {formatDip(t.sun_dip_pct)}
                      </TableCell>

                      <TableCell numeric className="font-bold" style={dipColor(t.avg_dip_pct)}>
                        {formatDip(t.avg_dip_pct)}
                      </TableCell>
                    </TableRow>
                  ))
                : (filtered as ArtistWeekendDipRow[]).map((artist) => (
                    <TableRow key={artist.artist_id}>
                      <TableCell>
                        <div className="flex items-center gap-2 min-w-0">
                          {artist.image_url ? (
                            <Image
                              src={artist.image_url}
                              alt={artist.artist_name ?? artist.artist_id}
                              width={28}
                              height={28}
                              className="h-7 w-7 rounded-full object-cover sb-ring flex-shrink-0"
                            />
                          ) : (
                            <div className="h-7 w-7 rounded-full sb-ring bg-white/60 dark:bg-white/10 flex-shrink-0" />
                          )}
                          <div className="min-w-0">
                            <Link
                              href={`/catalog?artist_id=${encodeURIComponent(artist.artist_id)}`}
                              className="font-medium transition-colors sb-link-hover block truncate"
                            >
                              {artist.artist_name ?? artist.artist_id}
                            </Link>
                            <div className="font-mono text-[10px] opacity-50 truncate">{artist.artist_id}</div>
                          </div>
                        </div>
                      </TableCell>

                      <TableCell numeric className="font-medium">
                        {formatInt(Number(artist.track_count ?? 0))}
                      </TableCell>

                      <TableCell numeric className={metricValueClass} style={metricValueStyle}>
                        {formatMetricValue(Number(artist.weekday_avg ?? 0))}
                      </TableCell>

                      <TableCell numeric className="font-semibold" style={dipColor(artist.sat_dip_pct)}>
                        {formatDip(artist.sat_dip_pct)}
                      </TableCell>

                      <TableCell numeric className="font-semibold" style={dipColor(artist.sun_dip_pct)}>
                        {formatDip(artist.sun_dip_pct)}
                      </TableCell>

                      <TableCell numeric className="font-bold" style={dipColor(artist.avg_dip_pct)}>
                        {formatDip(artist.avg_dip_pct)}
                      </TableCell>
                    </TableRow>
                  ))
            )}
          </GlassTable>
        </div>
      )}
    </details>
  );
}
