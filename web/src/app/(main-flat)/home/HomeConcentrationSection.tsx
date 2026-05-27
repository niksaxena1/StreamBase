"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PreviewableArtwork } from "@/components/ui/PreviewableArtwork";
import { Share2 } from "lucide-react";
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
import { fetchApiJson } from "@/lib/api";
import { formatDateISO, formatInt, formatUsd } from "@/lib/format";
import { readStoredBool, readStoredNumber, readStoredString, writeStoredBool, writeStoredNumber, writeStoredString } from "@/lib/storage";
import { ChartCsvDownloadButton } from "@/components/charts/ChartCsvDownloadButton";
import { todayIsoDate } from "@/lib/csv";
import { ArtistLinks } from "@/components/ui/ArtistLinks";
import { CopyableIsrc } from "@/components/ui/CopyableIsrc";
import { Modal } from "@/components/ui/Modal";
import { getChartColor, getChartTooltipStyle, useThemeColors } from "@/components/charts/useThemeColors";
import type { TrackStreamsXYPoint } from "@/components/charts/TrackStreamsXYChart";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ALL_COMPETITORS_KEY } from "@/lib/competitorContext";
import { ConcentrationFilterPicker, type PlaylistOption } from "./ConcentrationFilterPicker";
import type { HomeConcentrationPlaylistOption } from "./homeTypes";
import { IconButton } from "@/components/ui/Button";
import type { ConcentrationShareSnapshotV1 } from "@/lib/share/concentrationSnapshot";

const STORAGE_KEY_OPEN = "sb:home-concentration-open";
const STORAGE_KEY_MODE = "sb:home-concentration-mode";
const STORAGE_KEY_THRESHOLD = "sb:home-concentration-threshold";

type ViewMode = "total" | "daily";
type FilterMode = "all" | "artist" | "collector" | "playlist";

const SECTION_TITLE = "STREAM CONCENTRATION";

const HEADER_PILL_ACTIVE = "bg-black text-white dark:bg-white dark:text-black";
const HEADER_PILL_IDLE = "text-black/70 hover:bg-white/70 dark:text-white/70 dark:hover:bg-white/20";

function headerPill(active: boolean): string {
  return [
    "rounded-full px-2.5 py-1.5 text-[11px] font-medium transition",
    active ? HEADER_PILL_ACTIVE : HEADER_PILL_IDLE,
  ].join(" ");
}

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

// Build the Lorenz curve data: for each track (sorted by value desc),
// compute track count (x) and cumulative % of streams (y).
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
  trackScatterLoading?: boolean;
  latestRunDate: string | null;
  datasetMode?: "own" | "competitor";
  competitorLabelKey?: string | null;
  competitorPlaylists?: HomeConcentrationPlaylistOption[];
}) {
  const { metric } = useMetric();
  const { streamPayoutPerStreamUsd } = usePayoutRate();
  const colors = useThemeColors();
  const streamChartColor = getChartColor("streams", colors);
  const [open, setOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("total");
  const [threshold, setThreshold] = useState(50);
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [artistId, setArtistId] = useState<string | null>(null);
  const [collectorId, setCollectorId] = useState<string | null>(null);
  const [collectorIsrcs, setCollectorIsrcs] = useState<Set<string> | null>(null);
  const [collectorLoading, setCollectorLoading] = useState(false);
  const [playlistKey, setPlaylistKey] = useState<string | null>(null);
  const [playlists, setPlaylists] = useState<PlaylistOption[]>([]);
  const [playlistIsrcs, setPlaylistIsrcs] = useState<Set<string> | null>(null);
  const [playlistLoading, setPlaylistLoading] = useState(false);
  const [showCurveModal, setShowCurveModal] = useState(false);
  // Distro/ISRC column toggle (default: show distro), same pattern as /catalog top-track tables.
  const [showIsrcInDistroCol, setShowIsrcInDistroCol] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareHint, setShareHint] = useState<string | null>(null);

  useEffect(() => {
    setOpen(readStoredBool(STORAGE_KEY_OPEN, false));
    const m = readStoredString(STORAGE_KEY_MODE);
    if (m === "total" || m === "daily") setViewMode(m);
    setThreshold(readStoredNumber(STORAGE_KEY_THRESHOLD, 50));
  }, []);

  useEffect(() => { writeStoredBool(STORAGE_KEY_OPEN, open); }, [open]);
  useEffect(() => { writeStoredString(STORAGE_KEY_MODE, viewMode); }, [viewMode]);
  useEffect(() => { writeStoredNumber(STORAGE_KEY_THRESHOLD, threshold); }, [threshold]);

  useEffect(() => {
    setFilterMode("all");
    setArtistId(null);
    setCollectorId(null);
    setPlaylistKey(null);
    setPlaylistIsrcs(null);
    setCollectorIsrcs(null);
  }, [props.datasetMode, props.competitorLabelKey]);

  const isSpecificCompetitor =
    props.datasetMode === "competitor" &&
    props.competitorLabelKey &&
    props.competitorLabelKey !== ALL_COMPETITORS_KEY;

  const competitorPlaylistOptions = props.competitorPlaylists ?? [];

  // Fetch playlist list once on mount (own catalog), or use server-provided competitor playlists
  useEffect(() => {
    if (props.datasetMode === "competitor") {
      if (isSpecificCompetitor) {
        setPlaylists(competitorPlaylistOptions);
        return;
      }
      void fetchApiJson<{ playlists?: PlaylistOption[] }>("/api/competitors/playlists/options")
        .then((body) => {
          if (body.playlists) setPlaylists(body.playlists);
        })
        .catch(() => { /* ignore */ });
      return;
    }
    void fetchApiJson<{ playlists?: PlaylistOption[] }>("/api/playlists/options")
      .then((body) => {
        if (body.playlists) setPlaylists(body.playlists);
      })
      .catch(() => { /* ignore */ });
  }, [competitorPlaylistOptions, isSpecificCompetitor, props.datasetMode]);

  // Fetch ISRCs for selected playlist
  useEffect(() => {
    if (filterMode !== "playlist" || !playlistKey || !props.latestRunDate) {
      setPlaylistIsrcs(null);
      return;
    }
    let cancelled = false;
    setPlaylistLoading(true);

    const membershipsUrl =
      props.datasetMode === "competitor"
        ? "/api/competitors/playlists/memberships"
        : "/api/playlists/memberships";

    void fetchApiJson<{ rows?: Array<{ isrc: string }> }>(membershipsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: props.latestRunDate, playlist_keys: [playlistKey] }),
    })
      .then((body) => {
        if (cancelled) return;
        const isrcs = new Set<string>((body.rows ?? []).map((r) => r.isrc).filter(Boolean));
        setPlaylistIsrcs(isrcs);
        setPlaylistLoading(false);
      })
      .catch(() => {
        if (!cancelled) setPlaylistLoading(false);
      });

    return () => { cancelled = true; };
  }, [filterMode, playlistKey, props.datasetMode, props.latestRunDate]);

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
    if (filterMode === "playlist" && playlistIsrcs) {
      return props.trackScatterPoints.filter((p) => playlistIsrcs.has(p.isrc));
    }
    return props.trackScatterPoints;
  }, [props.trackScatterPoints, filterMode, artistId, collectorIsrcs, playlistIsrcs]);

  const getValue = useCallback(
    (p: TrackStreamsXYPoint) =>
      viewMode === "daily" ? p.daily_streams_delta : p.total_streams_cumulative,
    [viewMode]
  );

  const { sorted, grandTotal, thresholdIdx, cumPcts } = useMemo(() => {
    const s = [...filteredPoints].sort((a, b) => getValue(b) - getValue(a));
    const total = s.reduce((sum, p) => sum + Math.max(0, getValue(p)), 0);

    // Precompute prefix-sum cumulative percentages once (O(n))
    const cumPctsArr: number[] = new Array(s.length);
    let cum = 0;
    let tIdx = -1;
    for (let i = 0; i < s.length; i++) {
      cum += Math.max(0, getValue(s[i]));
      cumPctsArr[i] = total > 0 ? (cum / total) * 100 : 0;
      if (tIdx === -1 && total > 0 && cumPctsArr[i] >= threshold) {
        tIdx = i;
      }
    }

    return { sorted: s, grandTotal: total, thresholdIdx: tIdx, cumPcts: cumPctsArr };
  }, [filteredPoints, getValue, threshold]);

  const tracksAboveThreshold = thresholdIdx >= 0 ? thresholdIdx + 1 : sorted.length;

  // Lorenz curve data
  const lorenzData = useMemo(
    () => buildLorenzCurve(sorted, grandTotal, getValue),
    [sorted, grandTotal, getValue],
  );

  // Find the point on the Lorenz curve that corresponds to the current threshold
  const thresholdPoint = useMemo(() => {
    if (thresholdIdx < 0 || !lorenzData.length) return null;
    // lorenzData[0] is the origin (0,0), so index i+1 corresponds to track i
    return lorenzData[thresholdIdx + 1] ?? null;
  }, [lorenzData, thresholdIdx]);

  const isRevenue = metric === "revenue";
  const useAccentChrome = props.datasetMode === "competitor" && !isRevenue;
  const chromeColor = useAccentChrome
    ? "var(--sb-accent)"
    : isRevenue
      ? "#10b981"
      : "var(--sb-positive)";
  const chromeTint = (pct: number) =>
    useAccentChrome
      ? `color-mix(in srgb, var(--sb-accent) ${pct}%, transparent)`
      : isRevenue
        ? `color-mix(in srgb, #10b981 ${pct}%, transparent)`
        : `color-mix(in srgb, var(--sb-positive) ${pct}%, transparent)`;
  const thresholdChartColor = useAccentChrome ? colors.accent : colors.positive;
  const formatValue = (streams: number) =>
    isRevenue ? formatUsd(streams * streamPayoutPerStreamUsd) : formatInt(streams);
  const valueStyle = isRevenue ? ({ color: "#10b981" } as const) : ({ color: "var(--sb-positive)" } as const);
  const valueClass = "font-medium";

  const concentrationValueLabel = useMemo(() => {
    if (isRevenue) {
      return viewMode === "daily" ? "daily_revenue_usd" : "total_revenue_usd";
    }
    return viewMode === "daily" ? "daily_streams" : "total_streams";
  }, [isRevenue, viewMode]);

  const concentrationCsvRows = useMemo(() => {
    return sorted.map((p, i) => {
      const raw = Math.max(0, getValue(p));
      const valueExport = isRevenue ? Number(raw) * streamPayoutPerStreamUsd : raw;
      return {
        track: p.name ?? p.isrc,
        isrc: p.isrc,
        artists: (p.artist_names ?? []).join(", "),
        release_date: p.release_date ?? "",
        distro_playlist: p.distroPlaylistName ?? "",
        [concentrationValueLabel]: valueExport,
        share_pct: grandTotal > 0 ? ((raw / grandTotal) * 100).toFixed(2) : "0",
        cum_pct: (cumPcts[i] ?? 0).toFixed(2),
      } as Record<string, unknown>;
    });
  }, [sorted, grandTotal, cumPcts, getValue, isRevenue, streamPayoutPerStreamUsd, concentrationValueLabel]);

  const concentrationCsvHeaders = useMemo(
    () =>
      ["track", "isrc", "artists", "release_date", "distro_playlist", concentrationValueLabel, "share_pct", "cum_pct"] as string[],
    [concentrationValueLabel],
  );

  const selectedPlaylistName = playlistKey ? playlists.find((p) => p.playlist_key === playlistKey)?.display_name ?? playlistKey : null;
  const sectionSubtitle =
    filterMode === "artist" && artistId
      ? `${artists.find((a) => a.id === artistId)?.name ?? "Artist"}: ${viewMode === "daily" ? "daily" : "total"} streams ranked by share`
      : filterMode === "collector" && collectorId
        ? `${collectorId}: ${viewMode === "daily" ? "daily" : "total"} streams ranked by share${collectorLoading ? " (loading…)" : ""}`
        : filterMode === "playlist" && playlistKey
          ? `${selectedPlaylistName}: ${viewMode === "daily" ? "daily" : "total"} streams ranked by share${playlistLoading ? " (loading…)" : ""}`
          : `${props.datasetMode === "competitor" ? "Selected competitor" : "All catalog"} tracks ranked by ${
              viewMode === "daily" ? "daily" : "total"
            } stream share`;

  const concentrationSharePayload = useMemo((): ConcentrationShareSnapshotV1 | null => {
    if (sorted.length === 0) return null;
    const rows = sorted.map((p, i) => ({
      isrc: p.isrc,
      name: p.name,
      artist_names: p.artist_names,
      album_image_url: p.album_image_url,
      release_date: p.release_date ?? null,
      distroPlaylistName: p.distroPlaylistName ?? null,
      distroPlaylistImageUrl: p.distroPlaylistImageUrl ?? null,
      valueStreams: Math.max(0, getValue(p)),
      sharePct: grandTotal > 0 ? (Math.max(0, getValue(p)) / grandTotal) * 100 : 0,
      cumPct: cumPcts[i] ?? 0,
    }));
    return {
      v: 1,
      title: SECTION_TITLE,
      subtitle: sectionSubtitle,
      latestRunDate: props.latestRunDate,
      viewMode,
      metric: isRevenue ? "revenue" : "streams",
      streamPayoutPerStreamUsd,
      threshold,
      showIsrcColumn: showIsrcInDistroCol,
      tracksAboveThreshold,
      thresholdIdx,
      rowCount: rows.length,
      rows,
    };
  }, [
    sorted,
    grandTotal,
    cumPcts,
    getValue,
    viewMode,
    isRevenue,
    streamPayoutPerStreamUsd,
    threshold,
    showIsrcInDistroCol,
    tracksAboveThreshold,
    thresholdIdx,
    props.latestRunDate,
    sectionSubtitle,
  ]);

  const shareSnapshot = useCallback(async () => {
    if (!concentrationSharePayload) return;
    setShareBusy(true);
    setShareHint(null);
    try {
      const j = await fetchApiJson<{ url?: string; expires_at?: string }>("/api/share/concentration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(concentrationSharePayload),
      });
      const url = j.url;
      if (!url) throw new Error("Missing URL in response");
      const expLabel = j.expires_at ? formatDateISO(j.expires_at.slice(0, 10)) : null;
      const expiryNote = expLabel ? ` · expires ${expLabel}` : "";
      try {
        await navigator.clipboard.writeText(url);
        setShareHint(`Link copied${expiryNote}`);
      } catch {
        setShareHint(`${url}${expiryNote ? `\n${expiryNote.trim()}` : ""}`);
      }
    } catch (e) {
      setShareHint(e instanceof Error ? e.message : "Share failed");
    } finally {
      setShareBusy(false);
      window.setTimeout(() => setShareHint(null), 10000);
    }
  }, [concentrationSharePayload]);

  const shareDisabled =
    !concentrationSharePayload ||
    shareBusy ||
    (filterMode === "collector" && !!collectorId && collectorIsrcs === null) ||
    (filterMode === "playlist" && !!playlistKey && playlistIsrcs === null);

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
                  {SECTION_TITLE}
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

                <ConcentrationFilterPicker
                  artists={artists}
                  playlists={playlists}
                  filterMode={filterMode}
                  artistId={artistId}
                  collectorId={collectorId}
                  playlistKey={playlistKey}
                  onSelectAll={() => {
                    setFilterMode("all");
                    setArtistId(null);
                    setCollectorId(null);
                    setPlaylistKey(null);
                  }}
                  onSelectArtist={(id) => {
                    setFilterMode("artist");
                    setArtistId(id);
                    setCollectorId(null);
                    setPlaylistKey(null);
                  }}
                  onSelectCollector={(c) => {
                    setFilterMode("collector");
                    setCollectorId(c);
                    setArtistId(null);
                    setPlaylistKey(null);
                  }}
                  onSelectPlaylist={(k) => {
                    setFilterMode("playlist");
                    setPlaylistKey(k);
                    setArtistId(null);
                    setCollectorId(null);
                  }}
                  allLabel={props.datasetMode === "competitor" ? "Selected Competitor" : "All Catalog"}
                  showCollectorSection={props.datasetMode !== "competitor"}
                  showArtistSection
                  showPlaylistSection={
                    props.datasetMode !== "competitor" || playlists.length > 0
                  }
                />

                <IconButton
                  type="button"
                  onClick={() => void shareSnapshot()}
                  disabled={shareDisabled}
                  title="Create read-only share link (snapshot)"
                  aria-label="Create read-only share link"
                >
                  <Share2 className="h-3.5 w-3.5" />
                </IconButton>
                <ChartCsvDownloadButton
                  filename={`concentration-${viewMode}-${todayIsoDate()}.csv`}
                  rows={concentrationCsvRows}
                  headers={concentrationCsvHeaders}
                  sortForExport={false}
                  title="Download concentration CSV"
                />
                {shareHint ? (
                  <span className="text-[10px] max-w-[200px] truncate" style={{ color: "var(--sb-muted)" }} title={shareHint}>
                    {shareHint}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </summary>

        <div
          className="mt-3 space-y-3 rounded-xl p-2"
          style={useAccentChrome ? { background: chromeTint(8) } : undefined}
        >
          {/* Threshold slider + stats */}
          <div
            className="flex items-center gap-4 rounded-xl px-2 py-2"
            style={useAccentChrome ? { background: chromeTint(12) } : undefined}
          >
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
                style={{ color: chromeColor }}
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
              { label: "RELEASE", className: "hidden sm:table-cell" },
              {
                label: (
                  <button
                    type="button"
                    onClick={() => setShowIsrcInDistroCol((v) => !v)}
                    className="flex items-center gap-1 uppercase tracking-wider text-[11px] font-medium opacity-60 hover:opacity-100 transition-opacity"
                    title={showIsrcInDistroCol ? "Show distro playlist" : "Show ISRC"}
                  >
                    {showIsrcInDistroCol ? "ISRC" : "DISTRO"}
                    <span className="opacity-50 text-[9px]">⇄</span>
                  </button>
                ),
                className: "hidden sm:table-cell",
              },
              { label: isRevenue ? (viewMode === "daily" ? "DAILY REV" : "TOTAL REV") : (viewMode === "daily" ? "DAILY" : "TOTAL"), align: "right" as const },
              { label: "SHARE", align: "right" as const },
              { label: "CUM %", align: "right" as const },
            ]}
            maxBodyHeightClassName="max-h-[600px]"
          >
            {sorted.length === 0 ? (
              <EmptyState
                colSpan={7}
                message={props.trackScatterLoading ? "Loading tracks…" : "No tracks found"}
              />
            ) : (
              sorted.map((p, i) => {
                const val = Math.max(0, getValue(p));
                const sharePct = grandTotal > 0 ? (val / grandTotal) * 100 : 0;
                const cumPct = cumPcts[i] ?? 0;
                const isThresholdRow = i === thresholdIdx;
                const isAboveThreshold = thresholdIdx >= 0 && i <= thresholdIdx && tracksAboveThreshold < sorted.length;

                return (
                  <React.Fragment key={p.isrc}>
                    <TableRow style={isAboveThreshold ? { backgroundColor: chromeTint(6) } : undefined}>
                      <TableCell>
                        {p.album_image_url ? (
                          <PreviewableArtwork
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
                      <TableCell mono className="text-xs hidden sm:table-cell" style={{ color: "var(--sb-muted)" }}>
                        {formatDateISO(p.release_date ?? null)}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {showIsrcInDistroCol ? (
                          <CopyableIsrc
                            isrc={p.isrc}
                            className="font-mono text-xs opacity-40"
                            style={{ color: "var(--sb-muted)" }}
                          />
                        ) : p.distroPlaylistName ? (
                          <div className="flex items-center gap-1.5 min-w-0">
                            {p.distroPlaylistImageUrl ? (
                              <PreviewableArtwork src={p.distroPlaylistImageUrl} alt={p.distroPlaylistName} width={20} height={20} className="h-5 w-5 rounded flex-shrink-0 object-cover" />
                            ) : (
                              <div className="h-5 w-5 rounded flex-shrink-0 bg-orange-400/20" />
                            )}
                            <span className="truncate text-xs" style={{ color: "var(--sb-muted)" }}>{p.distroPlaylistName}</span>
                          </div>
                        ) : (
                          <span className="text-xs opacity-30" style={{ color: "var(--sb-muted)" }}>—</span>
                        )}
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
                      <tr aria-hidden>
                        <td colSpan={7} className="px-2 py-0">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 border-t" style={{ borderColor: chromeColor, opacity: 0.4 }} />
                            <span className="text-[10px] font-medium" style={{ color: chromeColor, opacity: 0.7 }}>
                              {threshold}% of {viewMode === "daily" ? "daily" : "total"} streams above
                            </span>
                            <div className="flex-1 border-t" style={{ borderColor: chromeColor, opacity: 0.4 }} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
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
        subtitle={[
          `${sorted.length} tracks`,
          filterMode === "artist" && artistId ? artists.find((a) => a.id === artistId)?.name : null,
          filterMode === "collector" && collectorId ? collectorId : null,
          filterMode === "playlist" && selectedPlaylistName ? selectedPlaylistName : null,
        ].filter(Boolean).join(" · ")}
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
            <span className="font-semibold" style={{ color: chromeColor }}>
              {tracksAboveThreshold}
            </span>
            {" "}of {sorted.length} tracks account for{" "}
            <span className="font-semibold" style={{ color: chromeColor }}>
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
                    <stop offset="0%" stopColor={streamChartColor} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={streamChartColor} stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={colors.border}
                  vertical={false}
                />
                <XAxis
                  dataKey="trackCount"
                  type="number"
                  domain={[0, sorted.length]}
                  stroke={colors.muted}
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  dataKey="cumPct"
                  type="number"
                  domain={[0, 100]}
                  tickFormatter={(v) => `${v}%`}
                  stroke={colors.muted}
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  width={32}
                />
                <Tooltip
                  contentStyle={getChartTooltipStyle(colors)}
                  formatter={((value: number | undefined, name: string | undefined) => {
                    if (name === "cumPct") return [`${value ?? 0}%`, "Streams"];
                    return [value ?? 0, name ?? ""];
                  }) as never}
                  labelFormatter={(label) => `${label} tracks`}
                />

                {/* Perfect equality line (diagonal) */}
                <Area
                  dataKey={() => null}
                  stroke="none"
                  fill="none"
                />

                {/* The Lorenz curve */}
                <Area
                  dataKey="cumPct"
                  stroke={streamChartColor}
                  strokeWidth={2}
                  fill="url(#lorenzFill)"
                  dot={false}
                  animationDuration={400}
                />

                {/* Threshold reference lines */}
                {thresholdPoint && (
                  <>
                    <ReferenceLine
                      x={thresholdPoint.trackCount}
                      stroke={thresholdChartColor}
                      strokeDasharray="4 4"
                      strokeOpacity={0.6}
                    />
                    <ReferenceLine
                      y={thresholdPoint.cumPct}
                      stroke={thresholdChartColor}
                      strokeDasharray="4 4"
                      strokeOpacity={0.6}
                    />
                    <ReferenceDot
                      x={thresholdPoint.trackCount}
                      y={thresholdPoint.cumPct}
                      r={5}
                      fill={thresholdChartColor}
                      stroke={colors.bg}
                      strokeWidth={2}
                    />
                  </>
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Inline slider to adjust threshold within modal */}
          <div
            className="flex items-center gap-3 rounded-xl px-2 py-2"
            style={useAccentChrome ? { background: chromeTint(12) } : undefined}
          >
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
              style={{ color: chromeColor }}
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
