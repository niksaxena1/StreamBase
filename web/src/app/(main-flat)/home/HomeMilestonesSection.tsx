"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useDeferredValue } from "react";
import { Search, Settings, X } from "lucide-react";

import { useMetric } from "@/components/metrics/MetricContext";
import { usePayoutRate } from "@/components/payout/PayoutRateContext";
import { Button, IconButton } from "@/components/ui/Button";
import { GlassTable, TableRow, TableCell, EmptyState } from "@/components/ui/GlassTable";
import { Modal } from "@/components/ui/Modal";
import { TracksPerMilestoneChart } from "@/components/charts/TracksPerMilestoneChart";
import { ChartCsvDownloadButton } from "@/components/charts/ChartCsvDownloadButton";
import { type TrackStreamsXYPoint } from "@/components/charts/TrackStreamsXYChart";
import { fetchApiJson } from "@/lib/api";
import { formatDateISO, formatInt, formatUsd } from "@/lib/format";
import { foldForSearch } from "@/lib/searchFold";
import { slugifyForFilename, todayIsoDate } from "@/lib/csv";
import { readStoredBool, writeStoredBool, readStoredString, writeStoredString, removeStoredItem } from "@/lib/storage";
import { CopyableIsrc } from "@/components/ui/CopyableIsrc";
import { PreviewableArtwork } from "@/components/ui/PreviewableArtwork";
import {
  HOME_DETAILS_STORAGE,
  HOME_MILESTONE_SETTINGS_STORAGE,
  parseMilestonesText,
  formatMilestoneForInput,
  formatMilestoneHeaderLabel,
  generateAutoMilestonesFromMax,
} from "./homeUtils";

export function HomeMilestonesSection(props: {
  trackScatterPoints: TrackStreamsXYPoint[];
}) {
  const { metric } = useMetric();
  const { streamPayoutPerStreamUsd } = usePayoutRate();

  const [openMilestones, setOpenMilestones] = useState(false);
  const [milestoneCountMode, setMilestoneCountMode] = useState<"tracks" | "artists">("tracks");
  const [milestoneBucketMode, setMilestoneBucketMode] = useState<"cumulative" | "exclusive">("cumulative");
  const [milestoneSettingsOpen, setMilestoneSettingsOpen] = useState(false);
  const [milestoneSettingsText, setMilestoneSettingsText] = useState("");
  const [milestoneSettingsError, setMilestoneSettingsError] = useState<string | null>(null);
  const [customMilestones, setCustomMilestones] = useState<number[] | null>(null);
  const [milestoneDrillOpen, setMilestoneDrillOpen] = useState(false);
  const [milestoneDrillMilestone, setMilestoneDrillMilestone] = useState<number | null>(null);
  const [milestoneDrillView, setMilestoneDrillView] = useState<"tracks" | "artists">("tracks");
  const [milestoneDrillQuery, setMilestoneDrillQuery] = useState("");
  const deferredMilestoneDrillQuery = useDeferredValue(milestoneDrillQuery);
  const [milestoneDrillPage, setMilestoneDrillPage] = useState(1);
  const [milestoneDrillArtistImagesById, setMilestoneDrillArtistImagesById] = useState<Map<string, string | null> | null>(null);

  const milestoneMode: "streams" | "revenue" = metric === "revenue" ? "revenue" : "streams";

  // Restore persisted state
  useEffect(() => {
    const restored = readStoredBool(HOME_DETAILS_STORAGE.milestoneOpen, false);
    if (restored) setOpenMilestones(true);

    function applySavedMilestones(saved: string) {
      const asNums = saved
        .split(/[\s,]+/g)
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x) && x >= 100_000)
        .map((x) => Math.round(x));

      if (asNums.length) {
        setCustomMilestones(Array.from(new Set(asNums)).sort((a, b) => b - a));
        return;
      }

      const looksUsd = /\$/.test(saved);
      const parsed = parseMilestonesText(saved, {
        mode: looksUsd ? "revenue" : "streams",
        payoutPerStreamUsd: streamPayoutPerStreamUsd,
      });
      if (!parsed.error && parsed.milestones.length) setCustomMilestones(parsed.milestones);
    }

    void fetchApiJson<{ home_custom_milestones_streams: string | null }>("/api/user-settings/home-milestones")
      .then((data) => {
        const csv = String(data.home_custom_milestones_streams ?? "").trim();
        if (csv) {
          applySavedMilestones(csv);
          writeStoredString(HOME_MILESTONE_SETTINGS_STORAGE.customMilestones, csv);
          return;
        }
        const savedLocal = readStoredString(HOME_MILESTONE_SETTINGS_STORAGE.customMilestones);
        if (savedLocal) applySavedMilestones(savedLocal);
      })
      .catch(() => {
        const savedLocal = readStoredString(HOME_MILESTONE_SETTINGS_STORAGE.customMilestones);
        if (savedLocal) applySavedMilestones(savedLocal);
      });
  }, []);

  useEffect(() => {
    writeStoredBool(HOME_DETAILS_STORAGE.milestoneOpen, openMilestones);
  }, [openMilestones]);

  // Load artist images for drill-down
  useEffect(() => {
    if (!milestoneDrillOpen) return;
    if (milestoneDrillView !== "artists") return;
    if (milestoneDrillArtistImagesById) return;

    let cancelled = false;
    async function load() {
      try {
        const json = await fetchApiJson<{ artists: Array<{ artist_id?: string; image_url?: string | null }> }>(
          "/api/artists/options",
        );
        const rows = Array.isArray(json.artists) ? json.artists : [];
        const map = new Map<string, string | null>();
        for (const r of rows) {
          const id = String(r?.artist_id ?? "");
          if (!id) continue;
          map.set(id, (r?.image_url ?? null) as string | null);
        }
        if (!cancelled) setMilestoneDrillArtistImagesById(map);
      } catch { /* ignore */ }
    }
    void load();
    return () => { cancelled = true; };
  }, [milestoneDrillArtistImagesById, milestoneDrillOpen, milestoneDrillView]);

  const autoMilestonesForCurrentData = useMemo(() => {
    const maxStreams = Math.max(
      0,
      ...(props.trackScatterPoints ?? []).map((p) => Number(p?.total_streams_cumulative ?? 0)),
    );
    return generateAutoMilestonesFromMax(maxStreams);
  }, [props.trackScatterPoints]);

  const activeMilestonesForEditing = (customMilestones?.length ? customMilestones : autoMilestonesForCurrentData) ?? [];
  const activeMilestonesSortedDesc = useMemo(() => {
    return [...activeMilestonesForEditing].sort((a, b) => b - a);
  }, [activeMilestonesForEditing]);

  const milestoneDrillUpperExclusive = useMemo(() => {
    if (milestoneBucketMode !== "exclusive") return null;
    const m = milestoneDrillMilestone;
    if (!m || m <= 0) return null;
    const idx = activeMilestonesSortedDesc.indexOf(m);
    return idx > 0 ? activeMilestonesSortedDesc[idx - 1] : null;
  }, [activeMilestonesSortedDesc, milestoneBucketMode, milestoneDrillMilestone]);

  const minActiveMilestone = useMemo(() => {
    if (!activeMilestonesForEditing.length) return 100_000;
    return Math.max(100_000, Math.min(...activeMilestonesForEditing));
  }, [activeMilestonesForEditing]);

  const belowMilestoneStats = useMemo(() => {
    const threshold = minActiveMilestone;
    let trackCount = 0;

    // Aggregate total streams per artist across all tracks
    const artistStreams = new Map<string, number>();
    for (const p of props.trackScatterPoints ?? []) {
      const n = Number(p?.total_streams_cumulative ?? 0);
      const ids = p.artist_ids ?? [];
      for (const id of ids) {
        if (!id) continue;
        artistStreams.set(id, (artistStreams.get(id) ?? 0) + (Number.isFinite(n) ? n : 0));
      }

      if (Number.isFinite(n) && n < threshold) {
        trackCount += 1;
      }
    }

    let artistsBelowCount = 0;
    for (const [, aggTotal] of artistStreams) {
      if (aggTotal < threshold) artistsBelowCount += 1;
    }

    return {
      trackCount,
      artistCount: artistsBelowCount,
      totalTracks: (props.trackScatterPoints ?? []).length,
      totalArtists: artistStreams.size,
    };
  }, [minActiveMilestone, props.trackScatterPoints]);

  const belowMilestoneCount = milestoneCountMode === "artists"
    ? belowMilestoneStats.artistCount
    : belowMilestoneStats.trackCount;

  const belowMilestonePctLabel = useMemo(() => {
    const total = milestoneCountMode === "artists"
      ? belowMilestoneStats.totalArtists
      : belowMilestoneStats.totalTracks;
    if (total <= 0) return "0%";
    const pct = Math.max(0, Math.min(100, (belowMilestoneCount / total) * 100));
    const s = pct >= 10 ? pct.toFixed(0) : pct.toFixed(1);
    return `${s}%`;
  }, [milestoneCountMode, belowMilestoneStats, belowMilestoneCount]);

  // Drill-down tracks
  const milestoneDrillTracks = useMemo(() => {
    const milestone = milestoneDrillMilestone;
    if (!milestone || milestone <= 0) return [];

    const q = foldForSearch(deferredMilestoneDrillQuery ?? "");
    const out: TrackStreamsXYPoint[] = [];
    const upperExclusive =
      milestoneBucketMode === "exclusive"
        ? (() => {
            const idx = activeMilestonesSortedDesc.indexOf(milestone);
            return idx > 0 ? activeMilestonesSortedDesc[idx - 1] : null;
          })()
        : null;

    for (const p of props.trackScatterPoints ?? []) {
      const total = Number(p?.total_streams_cumulative ?? 0);
      if (!Number.isFinite(total) || total < milestone) continue;
      if (upperExclusive != null && total >= upperExclusive) continue;

      if (q) {
        const isrc = String(p?.isrc ?? "");
        const title = String(p?.name ?? "").trim();
        const artists = (p?.artist_names ?? []).filter(Boolean).join(", ");
        if (!foldForSearch(isrc).includes(q) && !foldForSearch(title).includes(q) && !foldForSearch(artists).includes(q)) continue;
      }

      out.push(p);
    }

    out.sort((a, b) => {
      const ta = Number(a?.total_streams_cumulative ?? 0);
      const tb = Number(b?.total_streams_cumulative ?? 0);
      if (tb !== ta) return tb - ta;
      return String(a?.name ?? "").trim().localeCompare(String(b?.name ?? "").trim());
    });

    return out;
  }, [activeMilestonesSortedDesc, deferredMilestoneDrillQuery, milestoneBucketMode, milestoneDrillMilestone, props.trackScatterPoints]);

  type MilestoneDrillArtistRow = {
    key: string;
    artist_id: string | null;
    artist_name: string;
    track_count: number;
    total_streams_cumulative: number;
    daily_streams_delta: number;
  };

  // Drill-down artists — aggregate total streams per artist, then filter by aggregate
  const milestoneDrillArtists = useMemo((): MilestoneDrillArtistRow[] => {
    const milestone = milestoneDrillMilestone;
    if (!milestone || milestone <= 0) return [];

    const upperExclusive =
      milestoneBucketMode === "exclusive"
        ? (() => {
            const idx = activeMilestonesSortedDesc.indexOf(milestone);
            return idx > 0 ? activeMilestonesSortedDesc[idx - 1] : null;
          })()
        : null;

    // First pass: aggregate all tracks per artist (no milestone filter yet)
    const map = new Map<string, MilestoneDrillArtistRow>();
    for (const p of props.trackScatterPoints ?? []) {
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

    // Second pass: filter artists by their aggregate total streams
    let out: MilestoneDrillArtistRow[] = [];
    for (const [, agg] of map) {
      const aggTotal = agg.total_streams_cumulative;
      if (aggTotal < milestone) continue;
      if (upperExclusive != null && aggTotal >= upperExclusive) continue;
      out.push(agg);
    }

    const q = foldForSearch(deferredMilestoneDrillQuery ?? "");
    if (q) {
      out = out.filter((a) => {
        const nameL = foldForSearch(a.artist_name);
        const idL = a.artist_id ? foldForSearch(a.artist_id) : "";
        return nameL.includes(q) || idL.includes(q);
      });
    }

    const payout = streamPayoutPerStreamUsd;
    out.sort((a, b) => {
      const ta = metric === "revenue" ? a.total_streams_cumulative * payout : a.total_streams_cumulative;
      const tb = metric === "revenue" ? b.total_streams_cumulative * payout : b.total_streams_cumulative;
      if (tb !== ta) return tb - ta;
      return a.artist_name.localeCompare(b.artist_name);
    });
    return out;
  }, [activeMilestonesSortedDesc, deferredMilestoneDrillQuery, metric, milestoneBucketMode, milestoneDrillMilestone, props.trackScatterPoints, streamPayoutPerStreamUsd]);

  const pageSize = 50;
  const drillTotalCount = milestoneDrillView === "artists" ? milestoneDrillArtists.length : milestoneDrillTracks.length;
  const drillTotalPages = Math.max(1, Math.ceil(drillTotalCount / pageSize));
  const drillSafePage = Math.min(Math.max(1, milestoneDrillPage), drillTotalPages);
  const drillPageStart = (drillSafePage - 1) * pageSize;
  const drillTrackPageItems = milestoneDrillTracks.slice(drillPageStart, drillPageStart + pageSize);
  const drillArtistPageItems = milestoneDrillArtists.slice(drillPageStart, drillPageStart + pageSize);

  if (!props.trackScatterPoints?.length) return null;

  return (
    <>
      <details
        open={openMilestones}
        onToggle={(ev) => setOpenMilestones(ev.currentTarget.open)}
        className="rounded-xl border sb-panel p-3"
        style={{ borderColor: "var(--sb-border)" }}
      >
        <summary className="cursor-pointer select-none">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 flex-shrink-0 text-xs opacity-60">▸</span>
              <div className="text-[11px] font-medium uppercase tracking-wider opacity-60">
                {milestoneCountMode === "artists" ? "Artists" : "Tracks"} Per Milestone
              </div>
            </div>

            <div
              className="flex items-center gap-2"
              onMouseDown={(ev) => { ev.preventDefault(); ev.stopPropagation(); }}
              onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); }}
            >
              {openMilestones ? (
                <div className="text-[11px] opacity-70" style={{ color: "var(--sb-muted)" }}>
                  {formatInt(belowMilestoneCount)} ({belowMilestonePctLabel}) below{" "}
                  {formatMilestoneHeaderLabel(minActiveMilestone, milestoneMode, streamPayoutPerStreamUsd)}
                </div>
              ) : null}
              {openMilestones ? (
                <div className="flex items-center rounded-full bg-black/5 p-0.5 dark:bg-white/10">
                  <button type="button" onClick={() => setMilestoneCountMode("tracks")} className={["rounded-full px-2 py-1 text-[11px] font-medium transition", milestoneCountMode === "tracks" ? "bg-black text-white dark:bg-white dark:text-black" : "text-black/70 hover:bg-white/50 dark:text-white/70 dark:hover:bg-white/20"].join(" ")}>Tracks</button>
                  <button type="button" onClick={() => setMilestoneCountMode("artists")} className={["rounded-full px-2 py-1 text-[11px] font-medium transition", milestoneCountMode === "artists" ? "bg-black text-white dark:bg-white dark:text-black" : "text-black/70 hover:bg-white/50 dark:text-white/70 dark:hover:bg-white/20"].join(" ")}>Artists</button>
                </div>
              ) : null}
              {openMilestones ? (
                <div className="flex items-center rounded-full bg-black/5 p-0.5 dark:bg-white/10">
                  <button type="button" onClick={() => setMilestoneBucketMode("cumulative")} className={["rounded-full px-2 py-1 text-[11px] font-medium transition", milestoneBucketMode === "cumulative" ? "bg-black text-white dark:bg-white dark:text-black" : "text-black/70 hover:bg-white/50 dark:text-white/70 dark:hover:bg-white/20"].join(" ")} title="Cumulative: counts entities that reached this milestone or higher">Cum.</button>
                  <button type="button" onClick={() => setMilestoneBucketMode("exclusive")} className={["rounded-full px-2 py-1 text-[11px] font-medium transition", milestoneBucketMode === "exclusive" ? "bg-black text-white dark:bg-white dark:text-black" : "text-black/70 hover:bg-white/50 dark:text-white/70 dark:hover:bg-white/20"].join(" ")} title="Exclusive: each entity is counted only in its highest milestone bucket">Exc.</button>
                </div>
              ) : null}
              {openMilestones ? (
                <IconButton
                  aria-label="Configure milestones"
                  variant="ghost"
                  size="sm"
                  title="Configure milestones"
                  onClick={() => {
                    setMilestoneSettingsError(null);
                    setMilestoneSettingsText(
                      activeMilestonesForEditing
                        .map((n) => formatMilestoneHeaderLabel(n, milestoneMode, streamPayoutPerStreamUsd))
                        .join(", "),
                    );
                    setMilestoneSettingsOpen(true);
                  }}
                >
                  <Settings className="h-4 w-4 opacity-70" />
                </IconButton>
              ) : null}
            </div>
          </div>
        </summary>

        <div className="mt-2">
          <TracksPerMilestoneChart
            tracks={props.trackScatterPoints.map((p) => ({
              isrc: p.isrc,
              total_streams_cumulative: p.total_streams_cumulative,
              artist_ids: p.artist_ids ?? null,
            }))}
            heightPx={320}
            customMilestones={activeMilestonesSortedDesc.length ? activeMilestonesSortedDesc : undefined}
            mode={milestoneMode}
            countMode={milestoneCountMode}
            bucketMode={milestoneBucketMode}
            payoutPerStreamUsd={streamPayoutPerStreamUsd}
            highlightMilestone={milestoneDrillOpen ? milestoneDrillMilestone : null}
            onMilestoneClick={(milestone) => {
              setMilestoneDrillMilestone(milestone);
              setMilestoneDrillView(milestoneCountMode === "artists" ? "artists" : "tracks");
              setMilestoneDrillQuery("");
              setMilestoneDrillPage(1);
              setMilestoneDrillOpen(true);
            }}
          />
        </div>
      </details>

      {/* Milestone Settings Modal */}
      <Modal
        open={milestoneSettingsOpen}
        onClose={() => { setMilestoneSettingsOpen(false); setMilestoneSettingsError(null); }}
        title="Milestone settings"
        subtitle="Enter milestones separated by commas/spaces (supports 100k, 250k, 1m, 10m). Minimum is 100k."
        maxWidthClassName="max-w-xl"
        showCloseButton={false}
      >
        <div className="space-y-3">
          <label className="block text-xs font-medium" style={{ color: "var(--sb-text)" }}>Milestones</label>
          <textarea
            value={milestoneSettingsText}
            onChange={(e) => { setMilestoneSettingsText(e.target.value); setMilestoneSettingsError(null); }}
            placeholder="Example: 50m, 25m, 10m, 5m, 1m, 500k, 250k, 100k"
            rows={4}
            className={["sb-ring w-full rounded-xl bg-white/70 px-3 py-2 text-sm outline-none", "placeholder:text-black/40 dark:bg-white/5 dark:placeholder:text-white/40", "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sb-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sb-bg)]"].join(" ")}
            style={{ color: "var(--sb-text)" }}
          />
          {milestoneSettingsError ? <div className="text-xs text-red-600 dark:text-red-400">{milestoneSettingsError}</div> : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button type="button" variant="ghost" onClick={() => {
              setCustomMilestones(null);
              setMilestoneSettingsText("");
              setMilestoneSettingsError(null);
              removeStoredItem(HOME_MILESTONE_SETTINGS_STORAGE.customMilestones);
              void fetchApiJson("/api/user-settings/home-milestones", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ home_custom_milestones_streams: null }) }).catch(() => {});
            }}>Reset to auto</Button>
            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" onClick={() => { setMilestoneSettingsOpen(false); setMilestoneSettingsError(null); }}>Cancel</Button>
              <Button type="button" variant="primary" onClick={() => {
                const parsed = parseMilestonesText(milestoneSettingsText, { mode: milestoneMode, payoutPerStreamUsd: streamPayoutPerStreamUsd });
                if (parsed.error) { setMilestoneSettingsError(parsed.error); return; }
                setCustomMilestones(parsed.milestones);
                writeStoredString(HOME_MILESTONE_SETTINGS_STORAGE.customMilestones, parsed.milestones.join(","));
                void fetchApiJson("/api/user-settings/home-milestones", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ home_custom_milestones_streams: parsed.milestones.join(",") }) }).catch(() => {});
                setMilestoneSettingsOpen(false);
                setMilestoneSettingsError(null);
              }}>Save</Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Milestone Drill-down Modal */}
      <Modal
        open={milestoneDrillOpen}
        onClose={() => { setMilestoneDrillOpen(false); setMilestoneDrillQuery(""); setMilestoneDrillPage(1); }}
        title={milestoneDrillMilestone ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{milestoneDrillView === "artists" ? "Artists" : "Tracks"} at</span>
            <span className="font-mono">
              {formatMilestoneHeaderLabel(milestoneDrillMilestone, milestoneMode, streamPayoutPerStreamUsd)}
            </span>
            {milestoneBucketMode === "exclusive" && milestoneDrillUpperExclusive ? (
              <>
                <span className="opacity-70" style={{ color: "var(--sb-muted)" }}>–</span>
                <span className="font-mono">
                  {formatMilestoneHeaderLabel(milestoneDrillUpperExclusive, milestoneMode, streamPayoutPerStreamUsd)}
                </span>
              </>
            ) : (
              <span className="opacity-70" style={{ color: "var(--sb-muted)" }}>+</span>
            )}
            <span>{milestoneMode === "revenue" ? "total revenue" : "total streams"}</span>
          </div>
        ) : "Milestone drilldown"}
        maxWidthClassName="max-w-6xl"
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-[240px] flex-1 items-center gap-2">
              <div className="relative w-full">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-60" />
                <input
                  value={milestoneDrillQuery}
                  onChange={(e) => { setMilestoneDrillQuery(e.target.value); setMilestoneDrillPage(1); }}
                  placeholder={milestoneDrillView === "artists" ? "Filter by artist…" : "Filter by track, artist, or ISRC…"}
                  className={["sb-ring w-full rounded-xl bg-white/70 py-2 pl-10 pr-9 text-sm outline-none", "placeholder:text-black/40 dark:bg-white/5 dark:placeholder:text-white/40", "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sb-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sb-bg)]"].join(" ")}
                  style={{ color: "var(--sb-text)" }}
                />
                {milestoneDrillQuery.trim() ? (
                  <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 opacity-70 hover:opacity-100" style={{ color: "var(--sb-text)" }} onClick={() => { setMilestoneDrillQuery(""); setMilestoneDrillPage(1); }} aria-label="Clear filter">
                    <X className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center rounded-full bg-black/5 p-0.5 dark:bg-white/10">
                <button type="button" onClick={() => { setMilestoneDrillView("tracks"); setMilestoneDrillPage(1); }} className={["rounded-full px-2 py-1 text-[11px] font-medium transition", milestoneDrillView === "tracks" ? "bg-black text-white dark:bg-white dark:text-black" : "text-black/70 hover:bg-white/50 dark:text-white/70 dark:hover:bg-white/20"].join(" ")}>Tracks</button>
                <button type="button" onClick={() => { setMilestoneDrillView("artists"); setMilestoneDrillPage(1); }} className={["rounded-full px-2 py-1 text-[11px] font-medium transition", milestoneDrillView === "artists" ? "bg-black text-white dark:bg-white dark:text-black" : "text-black/70 hover:bg-white/50 dark:text-white/70 dark:hover:bg-white/20"].join(" ")}>Artists</button>
              </div>
              <div className="text-xs opacity-70" style={{ color: "var(--sb-muted)" }}>
                Showing <span className="font-mono">{drillTotalCount ? drillPageStart + 1 : 0}-{Math.min(drillPageStart + (milestoneDrillView === "artists" ? drillArtistPageItems.length : drillTrackPageItems.length), drillTotalCount)}</span> of <span className="font-mono">{formatInt(drillTotalCount)}</span>
              </div>
              <Button type="button" variant="ghost" disabled={drillSafePage <= 1} onClick={() => setMilestoneDrillPage((p) => Math.max(1, p - 1))}>Prev</Button>
              <div className="text-xs" style={{ color: "var(--sb-muted)" }}><span className="font-mono">{drillSafePage}</span> / <span className="font-mono">{drillTotalPages}</span></div>
              <Button type="button" variant="ghost" disabled={drillSafePage >= drillTotalPages} onClick={() => setMilestoneDrillPage((p) => Math.min(drillTotalPages, p + 1))}>Next</Button>
              <ChartCsvDownloadButton
                rows={milestoneDrillView === "artists" ? milestoneDrillArtists.map((a) => ({
                  artist_name: a.artist_name,
                  artist_id: a.artist_id,
                  track_count: a.track_count,
                  total_streams_cumulative: a.total_streams_cumulative,
                  daily_streams_delta: a.daily_streams_delta,
                })) : milestoneDrillTracks.map((t) => ({
                  isrc: t.isrc,
                  name: t.name,
                  artist_names: t.artist_names,
                  artist_ids: t.artist_ids,
                  release_date: t.release_date,
                  total_streams_cumulative: t.total_streams_cumulative,
                  daily_streams_delta: t.daily_streams_delta,
                }))}
                filename={`home-milestone-${slugifyForFilename(formatMilestoneForInput(milestoneDrillMilestone ?? 0))}-${milestoneDrillView}-${todayIsoDate()}.csv`}
                title="Download CSV"
              />
            </div>
          </div>

          {milestoneDrillView === "tracks" ? (
            <GlassTable
              headers={[
                { label: "Track" },
                { label: "Artists" },
                { label: "Release" },
                { label: metric === "revenue" ? "Total Revenue" : "Total Streams", align: "right" },
                { label: metric === "revenue" ? "Daily Revenue" : "Daily Streams", align: "right" },
              ]}
              maxBodyHeightClassName="max-h-[60vh] overflow-auto"
            >
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
                        {p.album_image_url ? <PreviewableArtwork src={p.album_image_url} alt="" width={36} height={36} className="h-9 w-9 rounded-md object-cover sb-ring" label={title} /> : <div className="h-9 w-9 rounded-md sb-ring bg-white/60 dark:bg-white/10" />}
                        <div className="min-w-0">
                          <Link href={`/catalog?isrc=${encodeURIComponent(p.isrc)}`} className="block truncate text-sm font-medium hover:underline" style={{ color: "var(--sb-text)" }} title={p.isrc}>{title}</Link>
                          <div className="truncate text-[11px] opacity-70" style={{ color: "var(--sb-muted)" }}>
                            <CopyableIsrc isrc={p.isrc} className="font-mono" />
                          </div>
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
                    <TableCell className="whitespace-nowrap text-sm font-mono opacity-70" style={{ color: "var(--sb-muted)" }}>
                      {formatDateISO((p as any)?.release_date ?? null)}
                    </TableCell>
                    <TableCell numeric className={cls} style={metric === "revenue" ? { color: "#10b981" } : undefined}>{metric === "revenue" ? formatUsd(totalValue) : formatInt(totalValue)}</TableCell>
                    <TableCell numeric className={cls} style={metric === "revenue" ? { color: "#10b981" } : undefined}>{metric === "revenue" ? formatUsd(dailyValue) : formatInt(dailyValue)}</TableCell>
                  </TableRow>
                );
              })}
              {!drillTrackPageItems.length && <EmptyState colSpan={5} message={milestoneDrillTracks.length ? "No tracks match your filter." : "No tracks found for this milestone."} />}
            </GlassTable>
          ) : (
            <GlassTable headers={[{ label: "Artist" }, { label: "Tracks", align: "right" }, { label: metric === "revenue" ? "Total Revenue" : "Total Streams", align: "right" }, { label: metric === "revenue" ? "Daily Revenue" : "Daily Streams", align: "right" }]} maxBodyHeightClassName="max-h-[60vh] overflow-auto">
              {drillArtistPageItems.map((a) => {
                const totalStreams = Number(a.total_streams_cumulative ?? 0);
                const dailyStreams = Number(a.daily_streams_delta ?? 0);
                const totalValue = metric === "revenue" ? totalStreams * streamPayoutPerStreamUsd : totalStreams;
                const dailyValue = metric === "revenue" ? dailyStreams * streamPayoutPerStreamUsd : dailyStreams;
                const cls = metric === "revenue" ? "font-medium" : "sb-positive font-medium";
                const imageUrl = a.artist_id ? (milestoneDrillArtistImagesById?.get(a.artist_id) ?? null) : null;
                return (
                  <TableRow key={a.key}>
                    <TableCell className="min-w-[260px]">
                      <div className="flex items-center gap-2">
                        {imageUrl ? <PreviewableArtwork src={imageUrl} alt="" width={36} height={36} className="h-9 w-9 rounded-full object-cover sb-ring" label={a.artist_name} /> : <div className="h-9 w-9 rounded-full sb-ring bg-white/60 dark:bg-white/10" />}
                        <div className="min-w-0">
                          {a.artist_id ? <Link href={`/catalog?artist_id=${encodeURIComponent(a.artist_id)}`} className="block truncate text-sm font-medium hover:underline" style={{ color: "var(--sb-text)" }} title={a.artist_id}>{a.artist_name}</Link> : <div className="truncate text-sm font-medium" style={{ color: "var(--sb-text)" }}>{a.artist_name}</div>}
                          {a.artist_id ? <div className="truncate text-[11px] opacity-70" style={{ color: "var(--sb-muted)" }}><span className="font-mono">{a.artist_id}</span></div> : null}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell numeric className="font-medium">{formatInt(a.track_count)}</TableCell>
                    <TableCell numeric className={cls} style={metric === "revenue" ? { color: "#10b981" } : undefined}>{metric === "revenue" ? formatUsd(totalValue) : formatInt(totalValue)}</TableCell>
                    <TableCell numeric className={cls} style={metric === "revenue" ? { color: "#10b981" } : undefined}>{metric === "revenue" ? formatUsd(dailyValue) : formatInt(dailyValue)}</TableCell>
                  </TableRow>
                );
              })}
              {!drillArtistPageItems.length && <EmptyState colSpan={4} message={milestoneDrillArtists.length ? "No artists match your filter." : "No artists found for this milestone."} />}
            </GlassTable>
          )}
        </div>
      </Modal>
    </>
  );
}
