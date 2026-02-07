"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useDeferredValue } from "react";
import { Search, Settings, X } from "lucide-react";

import { useMetric } from "@/components/metrics/MetricContext";
import { usePayoutRate } from "@/components/payout/PayoutRateContext";
import { Button, IconButton } from "@/components/ui/Button";
import { GlassTable, TableRow, TableCell, EmptyState } from "@/components/ui/GlassTable";
import { Modal } from "@/components/ui/Modal";
import { DailyStreamsDistributionChart, DEFAULT_DAILY_BUCKETS } from "@/components/charts/DailyStreamsDistributionChart";
import { type TrackStreamsXYPoint } from "@/components/charts/TrackStreamsXYChart";
import { formatInt, formatUsd } from "@/lib/format";
import { foldForSearch } from "@/lib/searchFold";
import { readStoredBool, writeStoredBool, readStoredString, writeStoredString, removeStoredItem } from "@/lib/storage";
import { HOME_DETAILS_STORAGE, HOME_DAILY_BUCKETS_STORAGE, parseDailyBucketsText } from "./homeUtils";

export function HomeDailyDistributionSection(props: {
  trackScatterPoints: TrackStreamsXYPoint[];
}) {
  const { metric } = useMetric();
  const { streamPayoutPerStreamUsd } = usePayoutRate();
  const milestoneMode: "streams" | "revenue" = metric === "revenue" ? "revenue" : "streams";

  const [openDailyDistribution, setOpenDailyDistribution] = useState(false);
  const [dailyDistributionCountMode, setDailyDistributionCountMode] = useState<"tracks" | "artists">("tracks");
  const [dailyDistributionBucketMode, setDailyDistributionBucketMode] = useState<"cumulative" | "exclusive">("cumulative");
  const [customDailyBuckets, setCustomDailyBuckets] = useState<Array<{ min: number; max: number | null; label: string }> | null>(null);
  const [dailyBucketsSettingsOpen, setDailyBucketsSettingsOpen] = useState(false);
  const [dailyBucketsSettingsText, setDailyBucketsSettingsText] = useState("");
  const [dailyBucketsSettingsError, setDailyBucketsSettingsError] = useState<string | null>(null);
  const [dailyDistDrillOpen, setDailyDistDrillOpen] = useState(false);
  const [dailyDistDrillBucket, setDailyDistDrillBucket] = useState<{ min: number; max: number | null; label: string } | null>(null);
  const [dailyDistDrillView, setDailyDistDrillView] = useState<"tracks" | "artists">("tracks");
  const [dailyDistDrillQuery, setDailyDistDrillQuery] = useState("");
  const deferredDailyDistDrillQuery = useDeferredValue(dailyDistDrillQuery);
  const [dailyDistDrillPage, setDailyDistDrillPage] = useState(1);
  const [dailyDistDrillArtistImagesById, setDailyDistDrillArtistImagesById] = useState<Map<string, string | null> | null>(null);

  // Restore persisted state
  useEffect(() => {
    const restored = readStoredBool(HOME_DETAILS_STORAGE.dailyDistOpen, false);
    if (restored) setOpenDailyDistribution(true);

    const savedLocal = readStoredString(HOME_DAILY_BUCKETS_STORAGE.customBuckets);
    if (savedLocal) {
      const parsed = parseDailyBucketsText(savedLocal);
      if (!parsed.error && parsed.buckets.length) setCustomDailyBuckets(parsed.buckets);
    }
  }, []);

  useEffect(() => {
    writeStoredBool(HOME_DETAILS_STORAGE.dailyDistOpen, openDailyDistribution);
  }, [openDailyDistribution]);

  // Load artist images for drill-down
  useEffect(() => {
    if (!dailyDistDrillOpen) return;
    if (dailyDistDrillView !== "artists") return;
    if (dailyDistDrillArtistImagesById) return;

    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/artists/options");
        const json = await res.json().catch(() => ({}));
        if (!res.ok) return;
        const rows = Array.isArray((json as any)?.artists) ? ((json as any).artists as any[]) : [];
        const map = new Map<string, string | null>();
        for (const r of rows) {
          const id = String(r?.artist_id ?? "");
          if (!id) continue;
          map.set(id, (r?.image_url ?? null) as string | null);
        }
        if (!cancelled) setDailyDistDrillArtistImagesById(map);
      } catch { /* ignore */ }
    }
    void load();
    return () => { cancelled = true; };
  }, [dailyDistDrillArtistImagesById, dailyDistDrillOpen, dailyDistDrillView]);

  // Drill-down tracks
  const dailyDistDrillTracks = useMemo(() => {
    const bucket = dailyDistDrillBucket;
    if (!bucket) return [];

    const q = foldForSearch(deferredDailyDistDrillQuery ?? "");
    const out: TrackStreamsXYPoint[] = [];

    for (const p of props.trackScatterPoints ?? []) {
      const daily = Number(p?.daily_streams_delta ?? 0);
      if (!Number.isFinite(daily) || daily < 0) continue;
      const inBucket = bucket.max === null ? daily >= bucket.min : daily >= bucket.min && daily < bucket.max;
      if (!inBucket) continue;

      if (q) {
        const isrc = String(p?.isrc ?? "");
        const title = String(p?.name ?? "").trim();
        const artists = (p?.artist_names ?? []).filter(Boolean).join(", ");
        if (!foldForSearch(isrc).includes(q) && !foldForSearch(title).includes(q) && !foldForSearch(artists).includes(q)) continue;
      }
      out.push(p);
    }

    out.sort((a, b) => {
      const da = Number(a?.daily_streams_delta ?? 0);
      const db = Number(b?.daily_streams_delta ?? 0);
      if (db !== da) return db - da;
      return String(a?.name ?? "").trim().localeCompare(String(b?.name ?? "").trim());
    });
    return out;
  }, [dailyDistDrillBucket, deferredDailyDistDrillQuery, props.trackScatterPoints]);

  type DailyDistDrillArtistRow = {
    key: string;
    artist_id: string | null;
    artist_name: string;
    track_count: number;
    total_streams_cumulative: number;
    daily_streams_delta: number;
  };

  // Drill-down artists
  const dailyDistDrillArtists = useMemo((): DailyDistDrillArtistRow[] => {
    const bucket = dailyDistDrillBucket;
    if (!bucket) return [];

    const map = new Map<string, DailyDistDrillArtistRow>();
    for (const p of props.trackScatterPoints ?? []) {
      const daily = Number(p?.daily_streams_delta ?? 0);
      if (!Number.isFinite(daily) || daily < 0) continue;
      const inBucket = bucket.max === null ? daily >= bucket.min : daily >= bucket.min && daily < bucket.max;
      if (!inBucket) continue;

      const artistNames = p?.artist_names ?? [];
      const artistIds = p?.artist_ids ?? [];
      const perTrackSeen = new Set<string>();
      for (let idx = 0; idx < artistNames.length; idx += 1) {
        const id = (artistIds as any[])[idx] ?? null;
        const label = String((artistNames as any[])[idx] ?? "").trim();
        if (!label && !id) continue;
        const key = id ? `id:${String(id)}` : `name:${foldForSearch(label)}`;
        if (perTrackSeen.has(key)) continue;
        perTrackSeen.add(key);

        const existing = map.get(key);
        if (existing) {
          existing.track_count += 1;
          existing.total_streams_cumulative += Number(p?.total_streams_cumulative ?? 0) || 0;
          existing.daily_streams_delta += Number(p?.daily_streams_delta ?? 0) || 0;
        } else {
          map.set(key, {
            key,
            artist_id: id ? String(id) : null,
            artist_name: label || (id ? String(id) : "Unknown artist"),
            track_count: 1,
            total_streams_cumulative: Number(p?.total_streams_cumulative ?? 0) || 0,
            daily_streams_delta: Number(p?.daily_streams_delta ?? 0) || 0,
          });
        }
      }
    }

    const q = foldForSearch(deferredDailyDistDrillQuery ?? "");
    let out = Array.from(map.values());
    if (q) {
      out = out.filter((a) => foldForSearch(a.artist_name).includes(q) || (a.artist_id ? foldForSearch(a.artist_id).includes(q) : false));
    }

    const payout = streamPayoutPerStreamUsd;
    out.sort((a, b) => {
      const da = metric === "revenue" ? a.daily_streams_delta * payout : a.daily_streams_delta;
      const db = metric === "revenue" ? b.daily_streams_delta * payout : b.daily_streams_delta;
      if (db !== da) return db - da;
      return a.artist_name.localeCompare(b.artist_name);
    });
    return out;
  }, [dailyDistDrillBucket, deferredDailyDistDrillQuery, metric, props.trackScatterPoints, streamPayoutPerStreamUsd]);

  const pageSize = 50;
  const drillTotalCount = dailyDistDrillView === "artists" ? dailyDistDrillArtists.length : dailyDistDrillTracks.length;
  const drillTotalPages = Math.max(1, Math.ceil(drillTotalCount / pageSize));
  const drillSafePage = Math.min(Math.max(1, dailyDistDrillPage), drillTotalPages);
  const drillPageStart = (drillSafePage - 1) * pageSize;
  const drillTrackPageItems = dailyDistDrillTracks.slice(drillPageStart, drillPageStart + pageSize);
  const drillArtistPageItems = dailyDistDrillArtists.slice(drillPageStart, drillPageStart + pageSize);

  if (!props.trackScatterPoints?.length) return null;

  return (
    <>
      <details
        open={openDailyDistribution}
        onToggle={(ev) => setOpenDailyDistribution(ev.currentTarget.open)}
        className="rounded-xl border sb-panel p-3"
        style={{ borderColor: "var(--sb-border)" }}
      >
        <summary className="cursor-pointer select-none">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 flex-shrink-0 text-xs opacity-60">▸</span>
              <div className="text-[11px] font-medium uppercase tracking-wider opacity-60">
                {dailyDistributionCountMode === "artists" ? "Artists" : "Tracks"} Per Daily {milestoneMode === "revenue" ? "Revenue" : "Streams"}
              </div>
            </div>
            <div className="flex items-center gap-2" onMouseDown={(ev) => { ev.preventDefault(); ev.stopPropagation(); }} onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); }}>
              {openDailyDistribution ? (
                <div className="flex items-center rounded-full bg-black/5 p-0.5 dark:bg-white/10">
                  <button type="button" onClick={() => setDailyDistributionCountMode("tracks")} className={["rounded-full px-2 py-1 text-[11px] font-medium transition", dailyDistributionCountMode === "tracks" ? "bg-black text-white dark:bg-white dark:text-black" : "text-black/70 hover:bg-white/50 dark:text-white/70 dark:hover:bg-white/20"].join(" ")}>Tracks</button>
                  <button type="button" onClick={() => setDailyDistributionCountMode("artists")} className={["rounded-full px-2 py-1 text-[11px] font-medium transition", dailyDistributionCountMode === "artists" ? "bg-black text-white dark:bg-white dark:text-black" : "text-black/70 hover:bg-white/50 dark:text-white/70 dark:hover:bg-white/20"].join(" ")}>Artists</button>
                </div>
              ) : null}
              {openDailyDistribution ? (
                <div className="flex items-center rounded-full bg-black/5 p-0.5 dark:bg-white/10">
                  <button type="button" onClick={() => setDailyDistributionBucketMode("cumulative")} className={["rounded-full px-2 py-1 text-[11px] font-medium transition", dailyDistributionBucketMode === "cumulative" ? "bg-black text-white dark:bg-white dark:text-black" : "text-black/70 hover:bg-white/50 dark:text-white/70 dark:hover:bg-white/20"].join(" ")} title="Cumulative: counts entities that have this daily stream count or higher">Cum.</button>
                  <button type="button" onClick={() => setDailyDistributionBucketMode("exclusive")} className={["rounded-full px-2 py-1 text-[11px] font-medium transition", dailyDistributionBucketMode === "exclusive" ? "bg-black text-white dark:bg-white dark:text-black" : "text-black/70 hover:bg-white/50 dark:text-white/70 dark:hover:bg-white/20"].join(" ")} title="Exclusive: each entity is counted only in its specific bucket">Exc.</button>
                </div>
              ) : null}
              {openDailyDistribution ? (
                <IconButton aria-label="Configure buckets" variant="ghost" size="sm" title="Configure buckets" onClick={() => {
                  setDailyBucketsSettingsError(null);
                  setDailyBucketsSettingsText((customDailyBuckets ?? DEFAULT_DAILY_BUCKETS).map((b) => b.label).join(", "));
                  setDailyBucketsSettingsOpen(true);
                }}>
                  <Settings className="h-4 w-4 opacity-70" />
                </IconButton>
              ) : null}
            </div>
          </div>
        </summary>

        <div className="mt-2">
          <DailyStreamsDistributionChart
            tracks={props.trackScatterPoints.map((p) => ({ isrc: p.isrc, daily_streams: p.daily_streams_delta, artist_ids: p.artist_ids ?? null }))}
            heightPx={280}
            mode={milestoneMode}
            countMode={dailyDistributionCountMode}
            bucketMode={dailyDistributionBucketMode}
            payoutPerStreamUsd={streamPayoutPerStreamUsd}
            customBuckets={customDailyBuckets ?? undefined}
            highlightBucketLabel={dailyDistDrillOpen ? dailyDistDrillBucket?.label : null}
            onBucketClick={(bucketMin, bucketMax, bucketLabel) => {
              setDailyDistDrillBucket({ min: bucketMin, max: bucketMax, label: bucketLabel });
              setDailyDistDrillView(dailyDistributionCountMode === "artists" ? "artists" : "tracks");
              setDailyDistDrillQuery("");
              setDailyDistDrillPage(1);
              setDailyDistDrillOpen(true);
            }}
          />
        </div>
      </details>

      {/* Daily Buckets Settings Modal */}
      <Modal
        open={dailyBucketsSettingsOpen}
        onClose={() => { setDailyBucketsSettingsOpen(false); setDailyBucketsSettingsError(null); }}
        title="Daily streams bucket settings"
        subtitle="Enter bucket ranges like: 0-100, 100-500, 500-1K, 1K-5K, 5K+ (use K for thousands)"
        maxWidthClassName="max-w-xl"
        showCloseButton={false}
      >
        <div className="space-y-3">
          <label className="block text-xs font-medium" style={{ color: "var(--sb-text)" }}>Buckets</label>
          <textarea
            value={dailyBucketsSettingsText}
            onChange={(e) => { setDailyBucketsSettingsText(e.target.value); setDailyBucketsSettingsError(null); }}
            placeholder="Example: 0-100, 100-500, 500-1K, 1K-2.5K, 2.5K-5K, 5K-10K, 10K+"
            rows={4}
            className={["sb-ring w-full rounded-xl bg-white/70 px-3 py-2 text-sm outline-none", "placeholder:text-black/40 dark:bg-white/5 dark:placeholder:text-white/40", "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sb-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sb-bg)]"].join(" ")}
            style={{ color: "var(--sb-text)" }}
          />
          {dailyBucketsSettingsError ? <div className="text-xs text-red-600 dark:text-red-400">{dailyBucketsSettingsError}</div> : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button type="button" variant="ghost" onClick={() => { setCustomDailyBuckets(null); setDailyBucketsSettingsText(""); setDailyBucketsSettingsError(null); removeStoredItem(HOME_DAILY_BUCKETS_STORAGE.customBuckets); }}>Reset to defaults</Button>
            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" onClick={() => { setDailyBucketsSettingsOpen(false); setDailyBucketsSettingsError(null); }}>Cancel</Button>
              <Button type="button" variant="primary" onClick={() => {
                const parsed = parseDailyBucketsText(dailyBucketsSettingsText);
                if (parsed.error) { setDailyBucketsSettingsError(parsed.error); return; }
                setCustomDailyBuckets(parsed.buckets);
                writeStoredString(HOME_DAILY_BUCKETS_STORAGE.customBuckets, parsed.buckets.map((b) => b.label).join(", "));
                setDailyBucketsSettingsOpen(false);
                setDailyBucketsSettingsError(null);
              }}>Save</Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Daily Distribution Drill-down Modal */}
      <Modal
        open={dailyDistDrillOpen}
        onClose={() => { setDailyDistDrillOpen(false); setDailyDistDrillQuery(""); setDailyDistDrillPage(1); }}
        title={dailyDistDrillBucket ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{dailyDistDrillView === "artists" ? "Artists" : "Tracks"} with</span>
            <span className="font-mono">{dailyDistDrillBucket.label}</span>
            <span>daily streams</span>
          </div>
        ) : "Daily streams drilldown"}
        subtitle={dailyDistDrillBucket ? (
          <span>
            Daily streams{" "}
            {dailyDistDrillBucket.max === null ? (<>≥ <span className="font-mono">{formatInt(dailyDistDrillBucket.min)}</span></>) : (<><span className="font-mono">{formatInt(dailyDistDrillBucket.min)}</span> – <span className="font-mono">{formatInt(dailyDistDrillBucket.max)}</span></>)}{" "}
            <span className="opacity-70" style={{ color: "var(--sb-muted)" }}>•</span>{" "}
            {formatInt(drillTotalCount)} {dailyDistDrillView === "artists" ? "artists" : "tracks"}
          </span>
        ) : null}
        maxWidthClassName="max-w-6xl"
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-[240px] flex-1 items-center gap-2">
              <div className="relative w-full">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-60" />
                <input
                  value={dailyDistDrillQuery}
                  onChange={(e) => { setDailyDistDrillQuery(e.target.value); setDailyDistDrillPage(1); }}
                  placeholder={dailyDistDrillView === "artists" ? "Filter by artist…" : "Filter by track, artist, or ISRC…"}
                  className={["sb-ring w-full rounded-xl bg-white/70 py-2 pl-10 pr-9 text-sm outline-none", "placeholder:text-black/40 dark:bg-white/5 dark:placeholder:text-white/40", "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sb-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sb-bg)]"].join(" ")}
                  style={{ color: "var(--sb-text)" }}
                />
                {dailyDistDrillQuery.trim() ? (
                  <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 opacity-70 hover:opacity-100" style={{ color: "var(--sb-text)" }} onClick={() => { setDailyDistDrillQuery(""); setDailyDistDrillPage(1); }} aria-label="Clear filter">
                    <X className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center rounded-full bg-black/5 p-0.5 dark:bg-white/10">
                <button type="button" onClick={() => { setDailyDistDrillView("tracks"); setDailyDistDrillPage(1); }} className={["rounded-full px-2 py-1 text-[11px] font-medium transition", dailyDistDrillView === "tracks" ? "bg-black text-white dark:bg-white dark:text-black" : "text-black/70 hover:bg-white/50 dark:text-white/70 dark:hover:bg-white/20"].join(" ")}>Tracks</button>
                <button type="button" onClick={() => { setDailyDistDrillView("artists"); setDailyDistDrillPage(1); }} className={["rounded-full px-2 py-1 text-[11px] font-medium transition", dailyDistDrillView === "artists" ? "bg-black text-white dark:bg-white dark:text-black" : "text-black/70 hover:bg-white/50 dark:text-white/70 dark:hover:bg-white/20"].join(" ")}>Artists</button>
              </div>
              <div className="text-xs opacity-70" style={{ color: "var(--sb-muted)" }}>
                Showing <span className="font-mono">{drillTotalCount ? drillPageStart + 1 : 0}-{Math.min(drillPageStart + (dailyDistDrillView === "artists" ? drillArtistPageItems.length : drillTrackPageItems.length), drillTotalCount)}</span> of <span className="font-mono">{formatInt(drillTotalCount)}</span>
              </div>
              <Button type="button" variant="ghost" disabled={drillSafePage <= 1} onClick={() => setDailyDistDrillPage((p) => Math.max(1, p - 1))}>Prev</Button>
              <div className="text-xs" style={{ color: "var(--sb-muted)" }}><span className="font-mono">{drillSafePage}</span> / <span className="font-mono">{drillTotalPages}</span></div>
              <Button type="button" variant="ghost" disabled={drillSafePage >= drillTotalPages} onClick={() => setDailyDistDrillPage((p) => Math.min(drillTotalPages, p + 1))}>Next</Button>
            </div>
          </div>

          {dailyDistDrillView === "tracks" ? (
            <GlassTable headers={[{ label: "Track" }, { label: "Artists" }, { label: metric === "revenue" ? "Daily Revenue" : "Daily Streams", align: "right" }, { label: metric === "revenue" ? "Total Revenue" : "Total Streams", align: "right" }]} maxBodyHeightClassName="max-h-[60vh] overflow-auto">
              {drillTrackPageItems.map((p) => {
                const title = String(p?.name ?? "").trim() || String(p?.isrc ?? "");
                const artists = (p?.artist_names ?? []).filter(Boolean);
                const totalStreams = Number(p?.total_streams_cumulative ?? 0);
                const dailyStreams = Number(p?.daily_streams_delta ?? 0);
                const totalValue = metric === "revenue" ? totalStreams * streamPayoutPerStreamUsd : totalStreams;
                const dailyValue = metric === "revenue" ? dailyStreams * streamPayoutPerStreamUsd : dailyStreams;
                const cls = metric === "revenue" ? "font-medium" : "sb-positive font-medium";
                return (
                  <TableRow key={p.isrc}>
                    <TableCell className="min-w-[260px]">
                      <div className="flex items-center gap-2">
                        {p.album_image_url ? <img src={p.album_image_url} alt="" className="h-9 w-9 rounded-md object-cover sb-ring" loading="lazy" decoding="async" /> : <div className="h-9 w-9 rounded-md sb-ring bg-white/60 dark:bg-white/10" />}
                        <div className="min-w-0">
                          <Link href={`/catalog?isrc=${encodeURIComponent(p.isrc)}`} className="block truncate text-sm font-medium hover:underline" style={{ color: "var(--sb-text)" }} title={p.isrc}>{title}</Link>
                          <div className="truncate text-[11px] opacity-70" style={{ color: "var(--sb-muted)" }}><span className="font-mono">{p.isrc}</span></div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="min-w-[240px]">
                      {artists.length ? (
                        <div className="truncate text-sm" style={{ color: "var(--sb-text)" }}>
                          {artists.map((name, idx) => {
                            const id = (p.artist_ids ?? [])[idx] ?? null;
                            const label = String(name ?? "").trim();
                            if (!label) return null;
                            return (<span key={`${p.isrc}-${idx}`}>{idx > 0 ? <span style={{ color: "var(--sb-muted)" }}>, </span> : null}{id ? <Link href={`/catalog?artist_id=${encodeURIComponent(id)}`} className="hover:underline" style={{ color: "var(--sb-text)" }} title={id}>{label}</Link> : <span>{label}</span>}</span>);
                          })}
                        </div>
                      ) : <span className="text-sm opacity-60" style={{ color: "var(--sb-muted)" }}>—</span>}
                    </TableCell>
                    <TableCell numeric className={cls} style={metric === "revenue" ? { color: "#10b981" } : undefined}>{metric === "revenue" ? formatUsd(dailyValue) : formatInt(dailyValue)}</TableCell>
                    <TableCell numeric className={cls} style={metric === "revenue" ? { color: "#10b981" } : undefined}>{metric === "revenue" ? formatUsd(totalValue) : formatInt(totalValue)}</TableCell>
                  </TableRow>
                );
              })}
              {!drillTrackPageItems.length && <EmptyState colSpan={4} message={dailyDistDrillTracks.length ? "No tracks match your filter." : "No tracks found for this bucket."} />}
            </GlassTable>
          ) : (
            <GlassTable headers={[{ label: "Artist" }, { label: "Tracks", align: "right" }, { label: metric === "revenue" ? "Daily Revenue" : "Daily Streams", align: "right" }, { label: metric === "revenue" ? "Total Revenue" : "Total Streams", align: "right" }]} maxBodyHeightClassName="max-h-[60vh] overflow-auto">
              {drillArtistPageItems.map((a) => {
                const totalStreams = Number(a.total_streams_cumulative ?? 0);
                const dailyStreams = Number(a.daily_streams_delta ?? 0);
                const totalValue = metric === "revenue" ? totalStreams * streamPayoutPerStreamUsd : totalStreams;
                const dailyValue = metric === "revenue" ? dailyStreams * streamPayoutPerStreamUsd : dailyStreams;
                const cls = metric === "revenue" ? "font-medium" : "sb-positive font-medium";
                const imageUrl = a.artist_id ? (dailyDistDrillArtistImagesById?.get(a.artist_id) ?? null) : null;
                return (
                  <TableRow key={a.key}>
                    <TableCell className="min-w-[260px]">
                      <div className="flex items-center gap-2">
                        {imageUrl ? <img src={imageUrl} alt="" className="h-9 w-9 rounded-full object-cover sb-ring" loading="lazy" decoding="async" /> : <div className="h-9 w-9 rounded-full sb-ring bg-white/60 dark:bg-white/10" />}
                        <div className="min-w-0">
                          {a.artist_id ? <Link href={`/catalog?artist_id=${encodeURIComponent(a.artist_id)}`} className="block truncate text-sm font-medium hover:underline" style={{ color: "var(--sb-text)" }} title={a.artist_id}>{a.artist_name}</Link> : <div className="truncate text-sm font-medium" style={{ color: "var(--sb-text)" }}>{a.artist_name}</div>}
                          {a.artist_id ? <div className="truncate text-[11px] opacity-70" style={{ color: "var(--sb-muted)" }}><span className="font-mono">{a.artist_id}</span></div> : null}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell numeric className="font-medium">{formatInt(a.track_count)}</TableCell>
                    <TableCell numeric className={cls} style={metric === "revenue" ? { color: "#10b981" } : undefined}>{metric === "revenue" ? formatUsd(dailyValue) : formatInt(dailyValue)}</TableCell>
                    <TableCell numeric className={cls} style={metric === "revenue" ? { color: "#10b981" } : undefined}>{metric === "revenue" ? formatUsd(totalValue) : formatInt(totalValue)}</TableCell>
                  </TableRow>
                );
              })}
              {!drillArtistPageItems.length && <EmptyState colSpan={4} message={dailyDistDrillArtists.length ? "No artists match your filter." : "No artists found for this bucket."} />}
            </GlassTable>
          )}
        </div>
      </Modal>
    </>
  );
}
