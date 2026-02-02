"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Download, Music, Search, Settings, X } from "lucide-react";

import { useMetric } from "@/components/metrics/MetricContext";
import { LazyInteractiveChartSection } from "@/components/dashboard/LazyInteractiveChartSection";
import { StatCard } from "@/components/StatCard";
import { Button, IconButton } from "@/components/ui/Button";
import { AnimatedCounter } from "@/components/ui/AnimatedCounter";
import { GlassTable, TableRow, TableCell, EmptyState } from "@/components/ui/GlassTable";
import { formatDateISO, formatInt, formatUsd } from "@/lib/format";
import { addDaysISO, dataDateFromRunDate, SOT_DATA_LAG_DAYS } from "@/lib/sotDates";
import { Alert } from "@/components/ui/Alert";
import { hrefWithPatchedSearchParams } from "@/lib/searchParams";
import { usePayoutRate } from "@/components/payout/PayoutRateContext";
import { TrackStreamsXYChart, type TrackStreamsXYPoint } from "@/components/charts/TrackStreamsXYChart";
import { ArtistStreamsXYChart, aggregateTracksToArtists } from "@/components/charts/ArtistStreamsXYChart";
import { TracksPerMilestoneChart } from "@/components/charts/TracksPerMilestoneChart";
import { DatePicker } from "@/components/ui/DatePicker";
import { foldForSearch } from "@/lib/searchFold";
import { Modal } from "@/components/ui/Modal";
import { FilterBuilder, type TrackDataPoint, type PlaylistDataPoint } from "@/components/filters";

type PlaylistDailyStatsRow = {
  date: string;
  track_count: number | null;
  total_streams_cumulative: number | null;
  daily_streams_net: number | null;
  est_revenue_total?: number | null;
  est_revenue_daily_net?: number | null;
};

import { computeRollingAvg7 } from "@/components/charts/chartUtils";

type ChartPoint = { date: string; value: number; ma7?: number | null };

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

const HOME_DETAILS_STORAGE = {
  scatterOpen: "sb:home:details:scatter_open",
  milestoneOpen: "sb:home:details:milestones_open",
  historyOpen: "sb:home:details:history_open",
} as const;

import {
  readStoredBool,
  writeStoredBool,
  readStoredString,
  writeStoredString,
  removeStoredItem,
} from "@/lib/storage";

const HOME_MILESTONE_SETTINGS_STORAGE = {
  customMilestones: "sb:home:milestones:custom_v1",
} as const;

function parseMilestonesText(
  input: string,
  args: { mode: "streams" | "revenue"; payoutPerStreamUsd: number },
): { milestones: number[]; error: string | null } {
  const raw = String(input ?? "").trim();
  if (!raw) return { milestones: [], error: null };

  const parts = raw
    .split(/[\s,]+/g)
    .map((p) => p.trim())
    .filter(Boolean);

  const out: number[] = [];
  for (const p0 of parts) {
    const cleaned = p0.toLowerCase().trim().replace(/_/g, "").replace(/,/g, "");
    const isUsd = args.mode === "revenue" || cleaned.startsWith("$");
    const p = cleaned.startsWith("$") ? cleaned.slice(1) : cleaned;

    const m = p.match(/^(\d+(?:\.\d+)?)([kmb])?$/i);
    if (!m) return { milestones: [], error: `Invalid milestone: "${p0}"` };

    const n = Number(m[1]);
    if (!Number.isFinite(n)) return { milestones: [], error: `Invalid milestone: "${p0}"` };

    const suffix = (m[2] ?? "").toLowerCase();
    const mult = suffix === "k" ? 1_000 : suffix === "m" ? 1_000_000 : suffix === "b" ? 1_000_000_000 : 1;
    const scaled = n * mult;
    if (!Number.isFinite(scaled) || scaled <= 0) return { milestones: [], error: `Invalid milestone: "${p0}"` };

    // Always store milestones in *streams* internally.
    const valueStreams = isUsd
      ? (() => {
          const rate = Number(args.payoutPerStreamUsd ?? 0);
          if (!Number.isFinite(rate) || rate <= 0) return NaN;
          return Math.round(scaled / rate);
        })()
      : Math.round(scaled);

    if (!Number.isFinite(valueStreams) || valueStreams <= 0) {
      return {
        milestones: [],
        error: isUsd
          ? "Revenue milestones require a valid payout rate."
          : `Invalid milestone: "${p0}"`,
      };
    }
    if (valueStreams < 100_000) return { milestones: [], error: `Minimum milestone is 100K (got ${p0})` };

    out.push(valueStreams);
  }

  const uniq = Array.from(new Set(out)).sort((a, b) => b - a);
  return { milestones: uniq, error: uniq.length ? null : "Please enter at least one milestone." };
}

function formatMilestoneForInput(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) {
    const b = n / 1_000_000_000;
    const s = Number.isInteger(b) ? String(b) : b.toFixed(1).replace(/\.0$/, "");
    return `${s}b`;
  }
  if (abs >= 1_000_000) {
    const m = n / 1_000_000;
    // Prefer nice decimals (e.g. 4.5m) instead of 4500k.
    const s = Number.isInteger(m) ? String(m) : m.toFixed(1).replace(/\.0$/, "");
    return `${s}m`;
  }
  if (abs >= 1_000) {
    const k = n / 1_000;
    const s = Number.isInteger(k) ? String(k) : k.toFixed(1).replace(/\.0$/, "");
    return `${s}k`;
  }
  return String(n);
}

function formatUsdCompact(n: number): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      maximumFractionDigits: n < 1000 ? 0 : 1,
    }).format(n);
  } catch {
    return `$${Math.round(n).toLocaleString("en-US")}`;
  }
}

function formatMilestoneHeaderLabel(
  streamsMilestone: number,
  mode: "streams" | "revenue",
  payoutPerStreamUsd: number,
): string {
  if (mode !== "revenue") return formatMilestoneForInput(streamsMilestone).toUpperCase();
  const usd = Math.max(0, streamsMilestone * Math.max(0, payoutPerStreamUsd));
  return formatUsdCompact(usd);
}

function generateAutoMilestonesFromMax(maxStreams: number): number[] {
  if (!Number.isFinite(maxStreams) || maxStreams <= 0) return [];

  // Keep in sync with `TracksPerMilestoneChart`: minimum is 100K.
  const possibleMilestones = [
    // Billions
    10_000_000_000, 5_000_000_000, 2_000_000_000, 1_000_000_000,
    // Hundreds of millions
    500_000_000, 400_000_000, 300_000_000, 200_000_000, 100_000_000,
    // Tens of millions
    50_000_000, 45_000_000, 40_000_000, 35_000_000, 30_000_000,
    25_000_000, 20_000_000, 19_000_000, 18_000_000, 17_000_000,
    16_000_000, 15_000_000, 14_000_000, 13_000_000, 12_000_000,
    11_000_000, 10_000_000, 9_000_000, 8_000_000, 7_000_000,
    6_000_000, 5_000_000, 4_500_000, 4_000_000, 3_500_000,
    3_000_000, 2_500_000, 2_000_000, 1_500_000, 1_000_000,
    // Hundreds of thousands
    900_000, 800_000, 750_000, 700_000, 600_000, 500_000,
    400_000, 300_000, 250_000, 200_000, 150_000, 100_000,
  ];

  const relevant = possibleMilestones.filter((m) => m <= maxStreams);
  if (!relevant.length) return [];

  const targetCount = 30;
  if (relevant.length <= targetCount) return relevant;

  const step = Math.ceil(relevant.length / targetCount);
  const thinned: number[] = [];
  for (let i = 0; i < relevant.length; i += step) thinned.push(relevant[i]);

  const smallest = relevant[relevant.length - 1];
  if (smallest && !thinned.includes(smallest)) thinned.push(smallest);
  return thinned;
}

// ============================================================================
// Filter Builder Section
// ============================================================================

function FilterBuilderSection({
  trackScatterPoints,
  trackScatterDataDate,
}: {
  trackScatterPoints: TrackStreamsXYPoint[];
  trackScatterDataDate: string | null;
}) {
  const [playlistOptions, setPlaylistOptions] = useState<
    Array<{ value: string; label: string; imageUrl?: string | null }>
  >([]);
  const [artistImagesById, setArtistImagesById] = useState<Map<string, string | null>>(new Map());

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/playlists/options");
        const json = await res.json().catch(() => ({}));
        if (!res.ok) return;
        const rows = Array.isArray((json as any)?.playlists) ? ((json as any).playlists as any[]) : [];
        const opts = rows
          .map((p) => ({
            value: String(p?.playlist_key ?? ""),
            label: String(p?.display_name ?? p?.playlist_key ?? "").trim(),
            imageUrl: (p?.spotify_playlist_image_url ?? null) as string | null,
          }))
          .filter((o) => o.value && o.label);
        if (!cancelled) setPlaylistOptions(opts);
      } catch {
        // ignore
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
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
        if (!cancelled) setArtistImagesById(map);
      } catch {
        // ignore
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Transform trackScatterPoints to TrackDataPoint format for FilterBuilder
  const trackData: TrackDataPoint[] = useMemo(() => {
    return (trackScatterPoints ?? []).map((p) => ({
      isrc: p.isrc,
      name: p.name ?? "",
      release_date: (p as any)?.release_date ?? null,
      first_seen: null,
      spotify_artist_names: p.artist_names ?? [],
      spotify_artist_ids: p.artist_ids ?? [],
      total_streams_cumulative: p.total_streams_cumulative,
      daily_streams: p.daily_streams_delta,
      spotify_track_id: null, // Not available in scatter points
      spotify_album_image_url: p.album_image_url,
      playlist_keys: [], // Would need playlist membership data
    }));
  }, [trackScatterPoints]);

  // Extract unique artists from tracks for the artist selector
  const artistOptions = useMemo(() => {
    const artistMap = new Map<string, { name: string; imageUrl: string | null; trackCount: number }>();
    
    for (const track of trackScatterPoints ?? []) {
      const ids = track.artist_ids ?? [];
      const names = track.artist_names ?? [];
      
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        const name = names[i] ?? "Unknown";
        if (!id) continue;
        
        const existing = artistMap.get(id);
        if (existing) {
          existing.trackCount++;
        } else {
          artistMap.set(id, { name, imageUrl: null, trackCount: 1 });
        }
      }
    }
    
    // Convert to options array and sort by track count (most tracks first)
    return Array.from(artistMap.entries())
      .map(([value, data]) => ({
        value,
        label: data.name,
        imageUrl: artistImagesById.get(value) ?? data.imageUrl,
        trackCount: data.trackCount,
      }))
      .sort((a, b) => b.trackCount - a.trackCount);
  }, [trackScatterPoints, artistImagesById]);

  // Build artist images map for aggregation
  const artistImages = useMemo(() => {
    const map = new Map<string, { name: string; image_url: string | null }>();
    for (const opt of artistOptions) {
      map.set(opt.value, { name: opt.label, image_url: opt.imageUrl });
    }
    return map;
  }, [artistOptions]);

  // Empty playlist data for now (would need to fetch from server)
  const playlistData: PlaylistDataPoint[] = useMemo(() => [], []);
  const asOfRunDate = useMemo(() => {
    if (!trackScatterDataDate) return null;
    return addDaysISO(trackScatterDataDate, SOT_DATA_LAG_DAYS);
  }, [trackScatterDataDate]);

  return (
    <FilterBuilder
      trackData={trackData}
      playlistData={playlistData}
      artistImages={artistImages}
      artistOptions={artistOptions}
      playlistOptions={playlistOptions}
      collectorOptions={[]}
      asOfRunDate={asOfRunDate}
    />
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
  const { metric } = useMetric();
  const { streamPayoutPerStreamUsd } = usePayoutRate();
  const [selectedChart, setSelectedChart] = useState<"daily" | "total">("daily");
  const [scatterQuery, setScatterQuery] = useState("");
  const deferredScatterQuery = useDeferredValue(scatterQuery);
  const [scatterFocusIsrc, setScatterFocusIsrc] = useState<string | null>(null);
  const [scatterFocusArtistId, setScatterFocusArtistId] = useState<string | null>(null);
  const [scatterSearchFocused, setScatterSearchFocused] = useState(false);
  const [scatterLogScale, setScatterLogScale] = useState(false);
  const [scatterView, setScatterView] = useState<"tracks" | "artists">("tracks");
  const [openScatter, setOpenScatter] = useState(false);
  const [openMilestones, setOpenMilestones] = useState(false);
  const [openHistory, setOpenHistory] = useState(false);

  // User setting: show/hide Filters section on Home
  const [homeFiltersEnabled, setHomeFiltersEnabled] = useState(true);
  const [homeFiltersConfigured, setHomeFiltersConfigured] = useState(true);
  const [milestoneSettingsOpen, setMilestoneSettingsOpen] = useState(false);
  const [milestoneSettingsText, setMilestoneSettingsText] = useState("");
  const [milestoneSettingsError, setMilestoneSettingsError] = useState<string | null>(null);
  const [customMilestones, setCustomMilestones] = useState<number[] | null>(null);
  const [milestoneDrillOpen, setMilestoneDrillOpen] = useState(false);
  const [milestoneDrillMilestone, setMilestoneDrillMilestone] = useState<number | null>(null);
  const [milestoneDrillQuery, setMilestoneDrillQuery] = useState("");
  const deferredMilestoneDrillQuery = useDeferredValue(milestoneDrillQuery);
  const [milestoneDrillPage, setMilestoneDrillPage] = useState(1);
  const autoMilestonesForCurrentData = useMemo(() => {
    const maxStreams = Math.max(
      0,
      ...(props.trackScatterPoints ?? []).map((p) => Number(p?.total_streams_cumulative ?? 0)),
    );
    return generateAutoMilestonesFromMax(maxStreams);
  }, [props.trackScatterPoints]);
  const activeMilestonesForEditing = (customMilestones?.length ? customMilestones : autoMilestonesForCurrentData) ?? [];
  const minActiveMilestone = useMemo(() => {
    if (!activeMilestonesForEditing.length) return 100_000;
    return Math.max(100_000, Math.min(...activeMilestonesForEditing));
  }, [activeMilestonesForEditing]);
  const tracksBelowAnyMilestoneCount = useMemo(() => {
    const threshold = minActiveMilestone;
    let count = 0;
    for (const p of props.trackScatterPoints ?? []) {
      const n = Number(p?.total_streams_cumulative ?? 0);
      if (Number.isFinite(n) && n < threshold) count += 1;
    }
    return count;
  }, [minActiveMilestone, props.trackScatterPoints]);
  const tracksBelowAnyMilestonePctLabel = useMemo(() => {
    const total = (props.trackScatterPoints ?? []).length;
    if (total <= 0) return "0%";
    const pct = Math.max(0, Math.min(100, (tracksBelowAnyMilestoneCount / total) * 100));
    const s = pct >= 10 ? pct.toFixed(0) : pct.toFixed(1);
    return `${s}%`;
  }, [props.trackScatterPoints, tracksBelowAnyMilestoneCount]);

  const milestoneMode: "streams" | "revenue" = metric === "revenue" ? "revenue" : "streams";

  const milestoneDrillTracks = useMemo(() => {
    const milestone = milestoneDrillMilestone;
    if (!milestone || milestone <= 0) return [];

    const q = foldForSearch(deferredMilestoneDrillQuery ?? "");
    const out: TrackStreamsXYPoint[] = [];
    for (const p of props.trackScatterPoints ?? []) {
      const total = Number(p?.total_streams_cumulative ?? 0);
      if (!Number.isFinite(total) || total < milestone) continue;

      if (q) {
        const isrc = String(p?.isrc ?? "");
        const title = String(p?.name ?? "").trim();
        const artists = (p?.artist_names ?? []).filter(Boolean).join(", ");

        const isrcL = foldForSearch(isrc);
        const titleL = foldForSearch(title);
        const artistsL = foldForSearch(artists);
        if (!isrcL.includes(q) && !titleL.includes(q) && !artistsL.includes(q)) continue;
      }

      out.push(p);
    }

    out.sort((a, b) => {
      const ta = Number(a?.total_streams_cumulative ?? 0);
      const tb = Number(b?.total_streams_cumulative ?? 0);
      if (tb !== ta) return tb - ta;
      const na = String(a?.name ?? "").trim();
      const nb = String(b?.name ?? "").trim();
      return na.localeCompare(nb);
    });

    return out;
  }, [deferredMilestoneDrillQuery, milestoneDrillMilestone, props.trackScatterPoints]);

  const milestoneDrillPageSize = 50;
  const milestoneDrillTotalPages = Math.max(1, Math.ceil(milestoneDrillTracks.length / milestoneDrillPageSize));
  const milestoneDrillSafePage = Math.min(Math.max(1, milestoneDrillPage), milestoneDrillTotalPages);
  const milestoneDrillPageStart = (milestoneDrillSafePage - 1) * milestoneDrillPageSize;
  const milestoneDrillPageItems = milestoneDrillTracks.slice(
    milestoneDrillPageStart,
    milestoneDrillPageStart + milestoneDrillPageSize,
  );

  // Restore persisted collapsible state after mount.
  useEffect(() => {
    setOpenScatter(readStoredBool(HOME_DETAILS_STORAGE.scatterOpen, false));
    setOpenMilestones(readStoredBool(HOME_DETAILS_STORAGE.milestoneOpen, false));
    setOpenHistory(readStoredBool(HOME_DETAILS_STORAGE.historyOpen, false));

    function applySavedMilestones(saved: string) {
      // Prefer new format: comma-separated stream milestone integers.
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

      // Back-compat: older saved strings like "50m, 10m, 100k" (streams) or "$200, $500".
      const looksUsd = /\$/.test(saved);
      const parsed = parseMilestonesText(saved, {
        mode: looksUsd ? "revenue" : "streams",
        payoutPerStreamUsd: streamPayoutPerStreamUsd,
      });
      if (!parsed.error && parsed.milestones.length) setCustomMilestones(parsed.milestones);
    }

    // Load from DB first (per-user, persists across devices). Fallback to localStorage.
    void fetch("/api/user-settings/home-milestones")
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return null;
        return data as any;
      })
      .then((data) => {
        const csv = String(data?.home_custom_milestones_streams ?? "").trim();
        if (csv) {
          applySavedMilestones(csv);
          // Keep local cache in sync (best-effort).
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

  // Fetch Home Filters setting (best-effort; defaults to enabled).
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/user-settings/home-filters");
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return;
        if (cancelled) return;
        setHomeFiltersEnabled((data as any)?.home_filters_enabled ?? true);
        setHomeFiltersConfigured((data as any)?.configured !== false);
      } catch {
        // ignore
      }
    }

    void load();

    function onUpdated() {
      void load();
    }

    window.addEventListener("sb:home-filters-setting-updated", onUpdated as any);
    return () => {
      cancelled = true;
      window.removeEventListener("sb:home-filters-setting-updated", onUpdated as any);
    };
  }, []);

  // Persist collapsible state.
  useEffect(() => {
    writeStoredBool(HOME_DETAILS_STORAGE.scatterOpen, openScatter);
  }, [openScatter]);

  useEffect(() => {
    writeStoredBool(HOME_DETAILS_STORAGE.milestoneOpen, openMilestones);
  }, [openMilestones]);

  useEffect(() => {
    writeStoredBool(HOME_DETAILS_STORAGE.historyOpen, openHistory);
  }, [openHistory]);

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
      color: undefined, // Let chart component use theme-aware accentStroke
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
          className="rounded-lg border-l-4 sb-blockquote-bg p-3 text-sm"
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
        accentColor={series.color}
        selectedChart={selectedChart}
        onSelectChart={setSelectedChart}
      />

      {props.historyErrorMessage ? (
        <Alert variant="error" title="Query error">
          {props.historyErrorMessage}
        </Alert>
      ) : null}

      {/* Track/Artist XY scatter (collapsible) */}
      <details
        open={openScatter}
        onToggle={(ev) => setOpenScatter(ev.currentTarget.open)}
        className="rounded-xl border sb-panel p-3"
        style={{ borderColor: "var(--sb-border)" }}
      >
        <summary className="cursor-pointer select-none">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 flex-shrink-0 text-xs opacity-60">▸</span>
              <div className="text-[11px] font-medium uppercase tracking-wider opacity-60">
                {scatterTitle}
              </div>
            </div>
            {openScatter ? (
              <div
                className="flex flex-wrap items-center justify-end gap-2"
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  ev.stopPropagation();
                }}
                onClick={(ev) => {
                  ev.preventDefault();
                  ev.stopPropagation();
                }}
              >
                <div
                  className="text-[11px] opacity-60"
                  title={
                    scatterMode === "revenue"
                      ? "X = cumulative revenue, Y = daily revenue change"
                      : "X = cumulative streams, Y = daily streams change"
                  }
                >
                  {scatterMode === "revenue"
                    ? "X: total revenue • Y: daily revenue"
                    : "X: total streams • Y: daily streams"}
                </div>
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
            ) : null}
          </div>
        </summary>

        <div className="mt-3">
          {props.trackScatterErrorMessage ? (
            <Alert variant="error" title="Track scatter query error">
              {props.trackScatterErrorMessage}
            </Alert>
          ) : null}
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
      </details>

      {/* Tracks Per Milestone Chart (collapsible) */}
      {props.trackScatterPoints?.length > 0 && (
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
                  Tracks Per Milestone
                </div>
              </div>

              <div
                className="flex items-center gap-2"
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  ev.stopPropagation();
                }}
                onClick={(ev) => {
                  ev.preventDefault();
                  ev.stopPropagation();
                }}
              >
                {openMilestones ? (
                  <div className="text-[11px] opacity-70" style={{ color: "var(--sb-muted)" }}>
                    {formatInt(tracksBelowAnyMilestoneCount)} ({tracksBelowAnyMilestonePctLabel}) below{" "}
                    {formatMilestoneHeaderLabel(minActiveMilestone, milestoneMode, streamPayoutPerStreamUsd)}
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
                      // Pre-fill with the currently active milestones (custom, otherwise auto-generated).
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
              }))}
              heightPx={320}
              customMilestones={customMilestones ?? undefined}
              mode={milestoneMode}
              payoutPerStreamUsd={streamPayoutPerStreamUsd}
              highlightMilestone={milestoneDrillOpen ? milestoneDrillMilestone : null}
              onMilestoneClick={(milestone) => {
                setMilestoneDrillMilestone(milestone);
                setMilestoneDrillQuery("");
                setMilestoneDrillPage(1);
                setMilestoneDrillOpen(true);
              }}
            />
          </div>
        </details>
      )}

      <Modal
        open={milestoneSettingsOpen}
        onClose={() => {
          setMilestoneSettingsOpen(false);
          setMilestoneSettingsError(null);
        }}
        title="Milestone settings"
        subtitle="Enter milestones separated by commas/spaces (supports 100k, 250k, 1m, 10m). Minimum is 100k."
        maxWidthClassName="max-w-xl"
        showCloseButton={false}
      >
        <div className="space-y-3">
          <label className="block text-xs font-medium" style={{ color: "var(--sb-text)" }}>
            Milestones
          </label>
          <textarea
            value={milestoneSettingsText}
            onChange={(e) => {
              setMilestoneSettingsText(e.target.value);
              setMilestoneSettingsError(null);
            }}
            placeholder="Example: 50m, 25m, 10m, 5m, 1m, 500k, 250k, 100k"
            rows={4}
            className={[
              "sb-ring w-full rounded-xl bg-white/70 px-3 py-2 text-sm outline-none",
              "placeholder:text-black/40 dark:bg-white/5 dark:placeholder:text-white/40",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sb-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sb-bg)]",
            ].join(" ")}
            style={{ color: "var(--sb-text)" }}
          />

          {milestoneSettingsError ? (
            <div className="text-xs text-red-600 dark:text-red-400">{milestoneSettingsError}</div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setCustomMilestones(null);
                setMilestoneSettingsText("");
                setMilestoneSettingsError(null);
                removeStoredItem(HOME_MILESTONE_SETTINGS_STORAGE.customMilestones);
                  // Persist clear to DB (best-effort).
                  void fetch("/api/user-settings/home-milestones", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ home_custom_milestones_streams: null }),
                  }).catch(() => {});
              }}
            >
              Reset to auto
            </Button>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setMilestoneSettingsOpen(false);
                  setMilestoneSettingsError(null);
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={() => {
                  const parsed = parseMilestonesText(milestoneSettingsText, {
                    mode: milestoneMode,
                    payoutPerStreamUsd: streamPayoutPerStreamUsd,
                  });
                  if (parsed.error) {
                    setMilestoneSettingsError(parsed.error);
                    return;
                  }
                  setCustomMilestones(parsed.milestones);
                  // Persist as raw stream milestones for stability across modes.
                  writeStoredString(
                    HOME_MILESTONE_SETTINGS_STORAGE.customMilestones,
                    parsed.milestones.join(","),
                  );
                  // Persist to DB (best-effort).
                  void fetch("/api/user-settings/home-milestones", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ home_custom_milestones_streams: parsed.milestones.join(",") }),
                  }).catch(() => {});
                  setMilestoneSettingsOpen(false);
                  setMilestoneSettingsError(null);
                }}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={milestoneDrillOpen}
        onClose={() => {
          setMilestoneDrillOpen(false);
          setMilestoneDrillQuery("");
          setMilestoneDrillPage(1);
        }}
        title={
          milestoneDrillMilestone ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>Tracks at</span>
              <span className="font-mono">
                {formatMilestoneHeaderLabel(milestoneDrillMilestone, milestoneMode, streamPayoutPerStreamUsd)}
              </span>
              <span className="opacity-70" style={{ color: "var(--sb-muted)" }}>
                +
              </span>
            </div>
          ) : (
            "Milestone tracks"
          )
        }
        subtitle={
          milestoneDrillMilestone ? (
            <span>
              Total streams ≥ <span className="font-mono">{formatInt(milestoneDrillMilestone)}</span>{" "}
              <span className="opacity-70" style={{ color: "var(--sb-muted)" }}>
                •
              </span>{" "}
              {formatInt(milestoneDrillTracks.length)} tracks
            </span>
          ) : null
        }
        maxWidthClassName="max-w-6xl"
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-[240px] flex-1 items-center gap-2">
              <div className="relative w-full">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-60" />
                <input
                  value={milestoneDrillQuery}
                  onChange={(e) => {
                    setMilestoneDrillQuery(e.target.value);
                    setMilestoneDrillPage(1);
                  }}
                  placeholder="Filter by track, artist, or ISRC…"
                  className={[
                    "sb-ring w-full rounded-xl bg-white/70 py-2 pl-10 pr-9 text-sm outline-none",
                    "placeholder:text-black/40 dark:bg-white/5 dark:placeholder:text-white/40",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sb-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sb-bg)]",
                  ].join(" ")}
                  style={{ color: "var(--sb-text)" }}
                />
                {milestoneDrillQuery.trim() ? (
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 opacity-70 hover:opacity-100"
                    style={{ color: "var(--sb-text)" }}
                    onClick={() => {
                      setMilestoneDrillQuery("");
                      setMilestoneDrillPage(1);
                    }}
                    aria-label="Clear filter"
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="text-xs opacity-70" style={{ color: "var(--sb-muted)" }}>
                Showing{" "}
                <span className="font-mono">
                  {milestoneDrillTracks.length ? milestoneDrillPageStart + 1 : 0}-
                  {Math.min(milestoneDrillPageStart + milestoneDrillPageItems.length, milestoneDrillTracks.length)}
                </span>{" "}
                of <span className="font-mono">{formatInt(milestoneDrillTracks.length)}</span>
              </div>
              <Button
                type="button"
                variant="ghost"
                disabled={milestoneDrillSafePage <= 1}
                onClick={() => setMilestoneDrillPage((p) => Math.max(1, p - 1))}
              >
                Prev
              </Button>
              <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
                <span className="font-mono">{milestoneDrillSafePage}</span> /{" "}
                <span className="font-mono">{milestoneDrillTotalPages}</span>
              </div>
              <Button
                type="button"
                variant="ghost"
                disabled={milestoneDrillSafePage >= milestoneDrillTotalPages}
                onClick={() => setMilestoneDrillPage((p) => Math.min(milestoneDrillTotalPages, p + 1))}
              >
                Next
              </Button>
            </div>
          </div>

          <GlassTable
            headers={[
              { label: "Track" },
              { label: "Artists" },
              {
                label: metric === "revenue" ? "Total Revenue" : "Total Streams",
                align: "right",
              },
              {
                label: metric === "revenue" ? "Daily Revenue" : "Daily Streams",
                align: "right",
              },
            ]}
            maxBodyHeightClassName="max-h-[60vh] overflow-auto"
          >
            {milestoneDrillPageItems.map((p) => {
              const title = String(p?.name ?? "").trim() || String(p?.isrc ?? "");
              const artists = (p?.artist_names ?? []).filter(Boolean);
              const totalStreams = Number(p?.total_streams_cumulative ?? 0);
              const dailyStreams = Number(p?.daily_streams_delta ?? 0);
              const totalValue =
                metric === "revenue" ? totalStreams * streamPayoutPerStreamUsd : totalStreams;
              const dailyValue =
                metric === "revenue" ? dailyStreams * streamPayoutPerStreamUsd : dailyStreams;
              const metricNumberClass =
                metric === "revenue"
                  ? "font-medium" // revenue uses emerald via inline style
                  : "sb-positive font-medium";

              return (
                <TableRow key={p.isrc}>
                  <TableCell className="min-w-[260px]">
                    <div className="flex items-center gap-2">
                      {p.album_image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.album_image_url}
                          alt=""
                          className="h-9 w-9 rounded-md object-cover sb-ring"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <div className="h-9 w-9 rounded-md sb-ring bg-white/60 dark:bg-white/10" />
                      )}
                      <div className="min-w-0">
                        <Link
                          href={`/catalog?isrc=${encodeURIComponent(p.isrc)}`}
                          className="block truncate text-sm font-medium hover:underline"
                          style={{ color: "var(--sb-text)" }}
                          title={p.isrc}
                        >
                          {title}
                        </Link>
                        <div className="truncate text-[11px] opacity-70" style={{ color: "var(--sb-muted)" }}>
                          <span className="font-mono">{p.isrc}</span>
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
                          const sep = idx > 0 ? (
                            <span key={`sep-${p.isrc}-${idx}`} style={{ color: "var(--sb-muted)" }}>
                              ,{" "}
                            </span>
                          ) : null;
                          return (
                            <span key={`${p.isrc}-${idx}`}>
                              {sep}
                              {id ? (
                                <Link
                                  href={`/catalog?artist_id=${encodeURIComponent(id)}`}
                                  className="hover:underline"
                                  style={{ color: "var(--sb-text)" }}
                                  title={id}
                                >
                                  {label}
                                </Link>
                              ) : (
                                <span>{label}</span>
                              )}
                            </span>
                          );
                        })}
                      </div>
                    ) : (
                      <span className="text-sm opacity-60" style={{ color: "var(--sb-muted)" }}>
                        —
                      </span>
                    )}
                  </TableCell>
                  <TableCell numeric className={metricNumberClass} style={metric === "revenue" ? { color: "#10b981" } : undefined}>
                    {metric === "revenue" ? formatUsd(totalValue) : formatInt(totalValue)}
                  </TableCell>
                  <TableCell numeric className={metricNumberClass} style={metric === "revenue" ? { color: "#10b981" } : undefined}>
                    {metric === "revenue" ? formatUsd(dailyValue) : formatInt(dailyValue)}
                  </TableCell>
                </TableRow>
              );
            })}
            {!milestoneDrillPageItems.length && (
              <EmptyState
                colSpan={4}
                message={milestoneDrillTracks.length ? "No tracks match your filter." : "No tracks found for this milestone."}
              />
            )}
          </GlassTable>
        </div>
      </Modal>

      {/* Recent History Table (collapsible) */}
      <details
        open={openHistory}
        onToggle={(ev) => setOpenHistory(ev.currentTarget.open)}
        className="rounded-xl border sb-panel p-3"
        style={{ borderColor: "var(--sb-border)" }}
      >
        <summary className="cursor-pointer select-none">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 flex-shrink-0 text-xs opacity-60">▸</span>
              <div className="text-[11px] font-medium uppercase tracking-wider opacity-60">
                Recent History
              </div>
            </div>
          </div>
        </summary>

        <div className="mt-3">
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
              <TableCell numeric className={metric === "revenue" ? "font-medium" : "sb-positive font-medium"} style={metric === "revenue" ? { color: "#10b981" } : undefined}>
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
      </details>

      {/* Dynamic Filter Builder (bottom-most, under Recent History) */}
      {homeFiltersConfigured && homeFiltersEnabled ? (
        <FilterBuilderSection
          trackScatterPoints={props.trackScatterPoints}
          trackScatterDataDate={props.trackScatterDataDate}
        />
      ) : null}
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
  return <HomeDashboardInner {...props} />;
}
