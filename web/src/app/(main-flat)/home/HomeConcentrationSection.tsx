"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useMetric } from "@/components/metrics/MetricContext";
import { usePayoutRate } from "@/components/payout/PayoutRateContext";
import { GlassTable, TableCell, TableRow, EmptyState } from "@/components/ui/GlassTable";
import { formatInt, formatUsd } from "@/lib/format";
import { readStoredBool, readStoredNumber, writeStoredBool, writeStoredNumber } from "@/lib/storage";
import { ChartCsvDownloadButton } from "@/components/charts/ChartCsvDownloadButton";
import { todayIsoDate } from "@/lib/csv";
import { ArtistLinks } from "@/components/ui/ArtistLinks";
import { Modal } from "@/components/ui/Modal";
import { useThemeColors, getChartTooltipStyle } from "@/components/charts/useThemeColors";
import type { TrackStreamsXYPoint } from "@/components/charts/TrackStreamsXYChart";
import { COLLECTOR_ORDER } from "@/app/(main-flat)/collectors/collectorsTypes";
import { COLLECTOR_COLORS } from "@/components/charts/CollectorComparisonChart";
import { supabaseBrowser } from "@/lib/supabase/client";

const STORAGE_KEY_OPEN = "sb:home-concentration-open";
const STORAGE_KEY_MODE = "sb:home-concentration-mode";
const STORAGE_KEY_THRESHOLD = "sb:home-concentration-threshold";

type ViewMode = "total" | "daily";

function deriveArtists(points: TrackStreamsXYPoint[]) {
  const byId = new Map<string, { name: string; imageUrl: string | null }>();
  for (const p of points) {
    const ids = p.artist_ids ?? [];
    const names = p.artist_names ?? [];
    for (let i = 0; i < Math.min(ids.length, names.length); i++) {
      const id = ids[i];
      const name = names[i];
      if (!id || !name) continue;
      if (!byId.has(id)) byId.set(id, { name, imageUrl: p.album_image_url ?? null });
    }
  }
  return Array.from(byId.entries())
    .map(([id, { name, imageUrl }]) => ({ id, name, imageUrl }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

type FilterMode = "all" | "artist" | "collector";

const PICKER_PANEL_STYLE = {
  backgroundColor: "var(--sb-card)",
  borderColor: "var(--sb-border-2)",
  backdropFilter: "blur(var(--sb-blur))",
  WebkitBackdropFilter: "blur(var(--sb-blur))",
} as const;

const PICKER_ITEM_CLS = "flex items-center gap-2 w-full text-left px-2 py-1.5 text-xs rounded transition-colors";
const PICKER_ITEM_ACTIVE = "bg-black/5 dark:bg-white/10 font-semibold";
const PICKER_ITEM_IDLE = "hover:bg-black/5 dark:hover:bg-white/10";

function CatalogFilterPicker({
  artists,
  filterMode,
  artistId,
  onSelectAll,
  onSelectArtist,
  onSelectCollectorMode,
}: {
  artists: { id: string; name: string; imageUrl: string | null }[];
  filterMode: FilterMode;
  artistId: string | null;
  onSelectAll: () => void;
  onSelectArtist: (id: string) => void;
  onSelectCollectorMode: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const selectedArtist = artistId ? artists.find((a) => a.id === artistId) ?? null : null;
  const filtered = search.trim()
    ? artists.filter((a) => a.name.toLowerCase().includes(search.trim().toLowerCase()))
    : artists;

  const buttonLabel = filterMode === "artist" && selectedArtist
    ? selectedArtist.name
    : filterMode === "collector"
      ? "By collector"
      : "All Catalog";

  const buttonImage = filterMode === "artist" && selectedArtist?.imageUrl
    ? selectedArtist.imageUrl
    : null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={[
          "flex items-center gap-1.5 text-xs px-2 py-1.5 rounded",
          "bg-white/20 dark:bg-white/10",
          "border border-white/10",
          "outline-none focus:outline-none",
          "max-w-[180px] min-w-[120px]",
          "transition-colors hover:bg-white/30 dark:hover:bg-white/15",
        ].join(" ")}
        style={{ color: "var(--sb-text)" }}
      >
        {buttonImage ? (
          <Image src={buttonImage} alt={buttonLabel} width={16} height={16} className="h-4 w-4 rounded-sm object-cover flex-shrink-0" />
        ) : (
          <div className="h-4 w-4 rounded-sm bg-white/30 dark:bg-white/20 flex-shrink-0" />
        )}
        <span className="truncate flex-1 text-left">{buttonLabel}</span>
        <span className="opacity-40 flex-shrink-0">▾</span>
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1.5 z-50 w-56 rounded-[var(--sb-radius)] border p-1 shadow-lg overflow-hidden"
          style={PICKER_PANEL_STYLE}
        >
          <div className="px-1 pb-1">
            <input
              autoFocus
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search artists…"
              className={[
                "w-full text-xs px-2 py-1.5 rounded",
                "bg-black/5 dark:bg-white/10",
                "outline-none focus:outline-none",
              ].join(" ")}
              style={{ color: "var(--sb-text)" }}
            />
          </div>
          <div className="max-h-56 overflow-y-auto">
            {/* All Catalog */}
            <button
              type="button"
              onClick={() => { onSelectAll(); setOpen(false); setSearch(""); }}
              className={[PICKER_ITEM_CLS, filterMode === "all" ? PICKER_ITEM_ACTIVE : PICKER_ITEM_IDLE].join(" ")}
              style={{ color: "var(--sb-text)" }}
            >
              <div className="h-6 w-6 rounded-sm flex-shrink-0 flex items-center justify-center text-[9px]" style={{ backgroundColor: "var(--sb-surface)", color: "var(--sb-muted)" }}>★</div>
              All Catalog
            </button>

            {/* Choose collector */}
            <button
              type="button"
              onClick={() => { onSelectCollectorMode(); setOpen(false); setSearch(""); }}
              className={[PICKER_ITEM_CLS, filterMode === "collector" ? PICKER_ITEM_ACTIVE : PICKER_ITEM_IDLE].join(" ")}
              style={{ color: "var(--sb-text)" }}
            >
              <div className="h-6 w-6 rounded-sm flex-shrink-0 flex items-center justify-center text-[9px]" style={{ backgroundColor: "var(--sb-surface)", color: "var(--sb-muted)" }}>◆</div>
              Choose collector
            </button>

            {/* Divider */}
            <div className="my-1 border-t" style={{ borderColor: "var(--sb-border)" }} />

            {/* Artist list */}
            {filtered.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => { onSelectArtist(a.id); setOpen(false); setSearch(""); }}
                className={[PICKER_ITEM_CLS, filterMode === "artist" && artistId === a.id ? PICKER_ITEM_ACTIVE : PICKER_ITEM_IDLE].join(" ")}
                style={{ color: "var(--sb-text)" }}
              >
                {a.imageUrl ? (
                  <Image src={a.imageUrl} alt={a.name} width={24} height={24} className="h-6 w-6 rounded-sm object-cover flex-shrink-0" />
                ) : (
                  <div className="h-6 w-6 rounded-sm flex-shrink-0" style={{ backgroundColor: "var(--sb-surface)" }} />
                )}
                <span className="truncate">{a.name}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-2 py-1.5 text-xs opacity-40" style={{ color: "var(--sb-muted)" }}>No artists found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CollectorPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (collector: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={[
          "flex items-center gap-1.5 text-xs px-2 py-1.5 rounded",
          "bg-white/20 dark:bg-white/10",
          "border border-white/10",
          "outline-none focus:outline-none",
          "min-w-[72px]",
          "transition-colors hover:bg-white/30 dark:hover:bg-white/15",
        ].join(" ")}
        style={{ color: "var(--sb-text)" }}
      >
        {value ? (
          <span className="h-3 w-3 rounded-full flex-shrink-0" style={{ backgroundColor: COLLECTOR_COLORS[value] ?? "var(--sb-muted)" }} />
        ) : (
          <span className="h-3 w-3 rounded-full flex-shrink-0 bg-white/30 dark:bg-white/20" />
        )}
        <span className="flex-1 text-left">{value ?? "Select…"}</span>
        <span className="opacity-40 flex-shrink-0">▾</span>
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1.5 z-50 w-36 rounded-[var(--sb-radius)] border p-1 shadow-lg overflow-hidden"
          style={PICKER_PANEL_STYLE}
        >
          {COLLECTOR_ORDER.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => { onChange(c); setOpen(false); }}
              className={[PICKER_ITEM_CLS, value === c ? PICKER_ITEM_ACTIVE : PICKER_ITEM_IDLE].join(" ")}
              style={{ color: "var(--sb-text)" }}
            >
              <span className="h-4 w-4 rounded-full flex-shrink-0" style={{ backgroundColor: COLLECTOR_COLORS[c] ?? "var(--sb-muted)" }} />
              <span className="font-medium">{c}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Build the Lorenz curve data: for each track (sorted by value desc),
// compute cumulative % of streams (x) and the track index / total (y).
function buildLorenzCurve(
  sorted: TrackStreamsXYPoint[],
  grandTotal: number,
  getValue: (p: TrackStreamsXYPoint) => number,
) {
  if (!grandTotal || !sorted.length) return [];
  const points: Array<{ cumPct: number; trackCount: number; name: string | null }> = [
    { cumPct: 0, trackCount: 0, name: null },
  ];
  let cum = 0;
  for (let i = 0; i < sorted.length; i++) {
    cum += Math.max(0, getValue(sorted[i]));
    points.push({
      cumPct: Math.round(((cum / grandTotal) * 100) * 10) / 10,
      trackCount: i + 1,
      name: sorted[i].name,
    });
  }
  return points;
}

export function HomeConcentrationSection(props: {
  trackScatterPoints: TrackStreamsXYPoint[];
  latestRunDate: string | null;
}) {
  const { metric } = useMetric();
  const { streamPayoutPerStreamUsd } = usePayoutRate();
  const colors = useThemeColors();
  const [open, setOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("total");
  const [threshold, setThreshold] = useState(50);
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [artistId, setArtistId] = useState<string | null>(null);
  const [collectorId, setCollectorId] = useState<string | null>(null);
  const [collectorIsrcs, setCollectorIsrcs] = useState<Set<string> | null>(null);
  const [collectorLoading, setCollectorLoading] = useState(false);
  const [showCurveModal, setShowCurveModal] = useState(false);

  useEffect(() => {
    setOpen(readStoredBool(STORAGE_KEY_OPEN, false));
    const m = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY_MODE) : null;
    if (m === "total" || m === "daily") setViewMode(m);
    setThreshold(readStoredNumber(STORAGE_KEY_THRESHOLD, 50));
  }, []);

  useEffect(() => { writeStoredBool(STORAGE_KEY_OPEN, open); }, [open]);
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY_MODE, viewMode); } catch { /* ignore */ }
  }, [viewMode]);
  useEffect(() => { writeStoredNumber(STORAGE_KEY_THRESHOLD, threshold); }, [threshold]);

  // Fetch ISRCs for selected collector
  useEffect(() => {
    if (filterMode !== "collector" || !collectorId || !props.latestRunDate) {
      setCollectorIsrcs(null);
      return;
    }
    let cancelled = false;
    setCollectorLoading(true);

    async function fetchCollectorIsrcs() {
      const sb = supabaseBrowser();
      const runDate = props.latestRunDate!;
      const prevDate = (() => {
        const d = new Date(`${runDate}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() - 1);
        return d.toISOString().slice(0, 10);
      })();

      const isrcs = new Set<string>();
      const pageSize = 1000;
      for (let offset = 0; offset < 10000; offset += pageSize) {
        const { data, error } = await sb.rpc("collector_tracks_paged", {
          collector: collectorId,
          run_date: runDate,
          prev_date: prevDate,
          offset_rows: offset,
          limit_rows: pageSize,
        });
        if (error || !data?.length) break;
        for (const row of data as Array<{ isrc: string }>) {
          if (row.isrc) isrcs.add(row.isrc);
        }
        if (data.length < pageSize) break;
      }

      if (!cancelled) {
        setCollectorIsrcs(isrcs);
        setCollectorLoading(false);
      }
    }

    void fetchCollectorIsrcs();
    return () => { cancelled = true; };
  }, [filterMode, collectorId, props.latestRunDate]);

  const artists = useMemo(() => deriveArtists(props.trackScatterPoints), [props.trackScatterPoints]);

  const filteredPoints = useMemo(() => {
    if (filterMode === "artist" && artistId) {
      return props.trackScatterPoints.filter((p) =>
        (p.artist_ids ?? []).includes(artistId),
      );
    }
    if (filterMode === "collector" && collectorIsrcs) {
      return props.trackScatterPoints.filter((p) => collectorIsrcs.has(p.isrc));
    }
    return props.trackScatterPoints;
  }, [props.trackScatterPoints, filterMode, artistId, collectorIsrcs]);

  const getValue = (p: TrackStreamsXYPoint) =>
    viewMode === "daily" ? p.daily_streams_delta : p.total_streams_cumulative;

  const { sorted, grandTotal, thresholdIdx } = useMemo(() => {
    const s = [...filteredPoints].sort((a, b) => getValue(b) - getValue(a));
    const total = s.reduce((sum, p) => sum + Math.max(0, getValue(p)), 0);

    let cum = 0;
    let tIdx = -1;
    for (let i = 0; i < s.length; i++) {
      cum += Math.max(0, getValue(s[i]));
      if (tIdx === -1 && total > 0 && (cum / total) * 100 >= threshold) {
        tIdx = i;
      }
    }

    return { sorted: s, grandTotal: total, thresholdIdx: tIdx };
  }, [filteredPoints, viewMode, threshold]); // eslint-disable-line react-hooks/exhaustive-deps

  const tracksAboveThreshold = thresholdIdx >= 0 ? thresholdIdx + 1 : sorted.length;

  // Lorenz curve data
  const lorenzData = useMemo(
    () => buildLorenzCurve(sorted, grandTotal, getValue),
    [sorted, grandTotal, viewMode], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Find the point on the Lorenz curve that corresponds to the current threshold
  const thresholdPoint = useMemo(() => {
    if (thresholdIdx < 0 || !lorenzData.length) return null;
    // lorenzData[0] is the origin (0,0), so index i+1 corresponds to track i
    return lorenzData[thresholdIdx + 1] ?? null;
  }, [lorenzData, thresholdIdx]);

  const isRevenue = metric === "revenue";
  const formatValue = (streams: number) =>
    isRevenue ? formatUsd(streams * streamPayoutPerStreamUsd) : formatInt(streams);
  const valueStyle = isRevenue ? ({ color: "#10b981" } as const) : ({ color: "var(--sb-positive)" } as const);
  const valueClass = "font-medium";

  const headerPill = (active: boolean) =>
    [
      "rounded-full px-2.5 py-1.5 text-[11px] font-medium transition",
      active
        ? "bg-black text-white dark:bg-white dark:text-black"
        : "text-black/70 hover:bg-white/70 dark:text-white/70 dark:hover:bg-white/20",
    ].join(" ");

  const sectionTitle = "STREAM CONCENTRATION";
  const sectionSubtitle =
    filterMode === "artist" && artistId
      ? `${artists.find((a) => a.id === artistId)?.name ?? "Artist"}: ${viewMode === "daily" ? "daily" : "total"} streams ranked by share`
      : filterMode === "collector" && collectorId
        ? `Collector ${collectorId}: ${viewMode === "daily" ? "daily" : "total"} streams ranked by share${collectorLoading ? " (loading…)" : ""}`
        : `All catalog tracks ranked by ${viewMode === "daily" ? "daily" : "total"} stream share`;

  return (
    <>
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

            {open ? (
              <div
                className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end"
                onMouseDown={(ev) => ev.stopPropagation()}
                onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); }}
              >
                <div className="sb-ring flex items-center gap-0.5 rounded-full bg-white/60 p-0.5 dark:bg-white/10">
                  <button type="button" onClick={() => setViewMode("total")} className={headerPill(viewMode === "total")}>
                    TOTAL
                  </button>
                  <button type="button" onClick={() => setViewMode("daily")} className={headerPill(viewMode === "daily")}>
                    DAILY
                  </button>
                </div>

                <CatalogFilterPicker
                  artists={artists}
                  filterMode={filterMode}
                  artistId={artistId}
                  onSelectAll={() => { setFilterMode("all"); setArtistId(null); setCollectorId(null); }}
                  onSelectArtist={(id) => { setFilterMode("artist"); setArtistId(id); setCollectorId(null); }}
                  onSelectCollectorMode={() => { setFilterMode("collector"); setArtistId(null); }}
                />
                {filterMode === "collector" && (
                  <CollectorPicker
                    value={collectorId}
                    onChange={setCollectorId}
                  />
                )}

                <ChartCsvDownloadButton
                  filename={`concentration-${viewMode}-${todayIsoDate()}.csv`}
                  rows={sorted.map((p) => ({
                    track: p.name ?? p.isrc,
                    isrc: p.isrc,
                    artists: (p.artist_names ?? []).join(", "),
                    value: getValue(p),
                    share_pct: grandTotal > 0 ? ((Math.max(0, getValue(p)) / grandTotal) * 100).toFixed(2) : "0",
                  }))}
                  title="Download concentration CSV"
                />
              </div>
            ) : null}
          </div>
        </summary>

        <div className="mt-3 space-y-3">
          {/* Threshold slider + stats */}
          <div className="flex items-center gap-4 px-1">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <label className="text-[11px] font-medium whitespace-nowrap" style={{ color: "var(--sb-muted)" }}>
                Threshold
              </label>
              <input
                type="range"
                min={10}
                max={100}
                step={5}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="flex-1 h-1 accent-current cursor-pointer"
                style={{ color: "var(--sb-positive)" }}
              />
              <span className="text-[11px] font-mono font-medium tabular-nums w-8 text-right" style={{ color: "var(--sb-muted)" }}>
                {threshold}%
              </span>
            </div>
            <div className="text-[11px] text-right whitespace-nowrap" style={{ color: "var(--sb-muted)" }}>
              {sorted.length} tracks
              {thresholdIdx >= 0 && tracksAboveThreshold < sorted.length && (
                <>
                  {" · "}
                  <button
                    type="button"
                    onClick={() => setShowCurveModal(true)}
                    className="underline decoration-dotted underline-offset-2 hover:opacity-80 transition-opacity cursor-pointer"
                    style={{ color: "var(--sb-muted)" }}
                    title="View concentration curve"
                  >
                    top {tracksAboveThreshold} = {threshold}%
                  </button>
                </>
              )}
            </div>
          </div>

          <GlassTable
            headers={[
              "",
              "TRACK",
              { label: "ISRC", className: "hidden sm:table-cell" },
              { label: isRevenue ? (viewMode === "daily" ? "DAILY REV" : "TOTAL REV") : (viewMode === "daily" ? "DAILY" : "TOTAL"), align: "right" as const },
              { label: "SHARE", align: "right" as const },
              { label: "CUM %", align: "right" as const },
            ]}
            maxBodyHeightClassName="max-h-[600px]"
          >
            {sorted.length === 0 ? (
              <EmptyState colSpan={6} message="No tracks found" />
            ) : (
              sorted.map((p, i) => {
                const val = Math.max(0, getValue(p));
                const sharePct = grandTotal > 0 ? (val / grandTotal) * 100 : 0;
                let cumPct = 0;
                if (grandTotal > 0) {
                  let cum = 0;
                  for (let j = 0; j <= i; j++) cum += Math.max(0, getValue(sorted[j]));
                  cumPct = (cum / grandTotal) * 100;
                }
                const isThresholdRow = i === thresholdIdx;
                const isAboveThreshold = thresholdIdx >= 0 && i <= thresholdIdx && tracksAboveThreshold < sorted.length;

                return (
                  <>{/* Fragment for row + optional divider */}
                    <TableRow key={p.isrc} style={isAboveThreshold ? { backgroundColor: "color-mix(in srgb, var(--sb-positive) 6%, transparent)" } : undefined}>
                      <TableCell>
                        {p.album_image_url ? (
                          <Image
                            src={p.album_image_url}
                            alt={p.name ?? p.isrc}
                            width={28}
                            height={28}
                            className="h-7 w-7 rounded-lg object-cover sb-ring flex-shrink-0"
                          />
                        ) : (
                          <div className="h-7 w-7 rounded-lg sb-ring bg-white/60 dark:bg-white/10 flex-shrink-0" />
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="min-w-0">
                          <Link
                            href={`/catalog?isrc=${encodeURIComponent(p.isrc)}`}
                            className="font-medium transition-colors sb-link-hover block truncate"
                          >
                            {p.name ?? p.isrc}
                          </Link>
                          {p.artist_names?.length ? (
                            <div className="text-[10px] opacity-50 truncate">
                              <ArtistLinks
                                artistNames={p.artist_names}
                                artistIds={p.artist_ids}
                                className="inline"
                              />
                            </div>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell mono className="text-xs opacity-40 hidden sm:table-cell" style={{ color: "var(--sb-muted)" }}>
                        {p.isrc}
                      </TableCell>
                      <TableCell numeric className={valueClass} style={valueStyle}>
                        {viewMode === "daily" ? `+${formatValue(val)}` : formatValue(val)}
                      </TableCell>
                      <TableCell numeric className="text-xs font-mono" style={{ color: "var(--sb-muted)", opacity: 0.7 }}>
                        {sharePct.toFixed(1)}%
                      </TableCell>
                      <TableCell numeric className="text-xs font-mono" style={{ color: "var(--sb-muted)" }}>
                        {cumPct.toFixed(1)}%
                      </TableCell>
                    </TableRow>
                    {isThresholdRow && tracksAboveThreshold < sorted.length && (
                      <tr key={`divider-${p.isrc}`} aria-hidden>
                        <td colSpan={6} className="px-2 py-0">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 border-t" style={{ borderColor: "var(--sb-positive)", opacity: 0.4 }} />
                            <span className="text-[10px] font-medium" style={{ color: "var(--sb-positive)", opacity: 0.7 }}>
                              {threshold}% of {viewMode === "daily" ? "daily" : "total"} streams above
                            </span>
                            <div className="flex-1 border-t" style={{ borderColor: "var(--sb-positive)", opacity: 0.4 }} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })
            )}
          </GlassTable>
        </div>
      </details>

      {/* Lorenz / concentration curve modal */}
      <Modal
        open={showCurveModal}
        onClose={() => setShowCurveModal(false)}
        title="Concentration curve"
        subtitle={`${sorted.length} tracks${filterMode === "artist" && artistId ? ` · ${artists.find((a) => a.id === artistId)?.name ?? ""}` : filterMode === "collector" && collectorId ? ` · Collector ${collectorId}` : ""}`}
        headerCenter={
          <div className="sb-ring flex items-center gap-0.5 rounded-full bg-white/60 p-0.5 dark:bg-white/10">
            <button type="button" onClick={() => setViewMode("total")} className={headerPill(viewMode === "total")}>
              TOTAL
            </button>
            <button type="button" onClick={() => setViewMode("daily")} className={headerPill(viewMode === "daily")}>
              DAILY
            </button>
          </div>
        }
        maxWidthClassName="max-w-2xl"
      >
        <div className="space-y-4">

          {/* Key stat */}
          <div className="text-center text-sm" style={{ color: "var(--sb-text)" }}>
            <span className="font-semibold" style={{ color: "var(--sb-positive)" }}>
              {tracksAboveThreshold}
            </span>
            {" "}of {sorted.length} tracks account for{" "}
            <span className="font-semibold" style={{ color: "var(--sb-positive)" }}>
              {threshold}%
            </span>
            {" "}of {viewMode === "daily" ? "daily" : "total"} streams
          </div>

          {/* Chart */}
          <div className="h-[320px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={lorenzData}
                margin={{ top: 10, right: 10, left: 0, bottom: 4 }}
              >
                <defs>
                  <linearGradient id="lorenzFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={colors.accentStroke} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={colors.accentStroke} stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={colors.border}
                  vertical={false}
                />
                <XAxis
                  dataKey="cumPct"
                  type="number"
                  domain={[0, 100]}
                  tickFormatter={(v) => `${v}%`}
                  stroke={colors.muted}
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  dataKey="trackCount"
                  type="number"
                  domain={[0, sorted.length]}
                  stroke={colors.muted}
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  width={32}
                />
                <Tooltip
                  contentStyle={getChartTooltipStyle(colors)}
                  formatter={((value: number | undefined, name: string | undefined) => {
                    if (name === "trackCount") return [`${value ?? 0} tracks`, "Tracks"];
                    return [value ?? 0, name ?? ""];
                  }) as never}
                  labelFormatter={(label) => `${label}% of streams`}
                />

                {/* Perfect equality line (diagonal) */}
                <Area
                  dataKey={() => null}
                  stroke="none"
                  fill="none"
                />

                {/* The Lorenz curve */}
                <Area
                  dataKey="trackCount"
                  stroke={colors.accentStroke}
                  strokeWidth={2}
                  fill="url(#lorenzFill)"
                  dot={false}
                  animationDuration={400}
                />

                {/* Threshold reference lines */}
                {thresholdPoint && (
                  <>
                    <ReferenceLine
                      x={thresholdPoint.cumPct}
                      stroke={colors.positive}
                      strokeDasharray="4 4"
                      strokeOpacity={0.6}
                    />
                    <ReferenceLine
                      y={thresholdPoint.trackCount}
                      stroke={colors.positive}
                      strokeDasharray="4 4"
                      strokeOpacity={0.6}
                    />
                    <ReferenceDot
                      x={thresholdPoint.cumPct}
                      y={thresholdPoint.trackCount}
                      r={5}
                      fill={colors.positive}
                      stroke={colors.bg}
                      strokeWidth={2}
                    />
                  </>
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Inline slider to adjust threshold within modal */}
          <div className="flex items-center gap-3 px-1">
            <label className="text-xs font-medium whitespace-nowrap" style={{ color: "var(--sb-muted)" }}>
              Threshold
            </label>
            <input
              type="range"
              min={10}
              max={100}
              step={5}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="flex-1 h-1 accent-current cursor-pointer"
              style={{ color: "var(--sb-positive)" }}
            />
            <span className="text-xs font-mono font-medium tabular-nums w-8 text-right" style={{ color: "var(--sb-muted)" }}>
              {threshold}%
            </span>
          </div>

          <div className="text-[10px] text-center opacity-40" style={{ color: "var(--sb-muted)" }}>
            A steep initial rise means a few tracks dominate. A more linear shape means streams are evenly spread.
          </div>
        </div>
      </Modal>
    </>
  );
}
