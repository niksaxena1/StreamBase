"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { ForwardRefExoticComponent, RefAttributes } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import NextImage from "next/image";
import type {
  ForceGraphMethods,
  ForceGraphProps,
  NodeObject,
  LinkObject,
} from "react-force-graph-2d";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Search,
  RotateCcw,
  ImageIcon,
  Scaling,
  UserRound,
  ListMusic,
  Disc3,
  SquareDashed,
  Keyboard,
  Download,
  Loader2,
  X,
} from "lucide-react";
import { formatDateISO, formatInt } from "@/lib/format";
import { slugifyForFilename, todayIsoDate } from "@/lib/csv";
import {
  downloadNetworkViewXlsx,
  type NetworkArtistStreamExportRow,
  type NetworkTrackSheetEnrichment,
  type NetworkViewExportEdge,
} from "@/lib/networkViewXlsx";
import { ChartCsvDownloadButton } from "@/components/charts/ChartCsvDownloadButton";
import { useThemeColors } from "@/components/charts/useThemeColors";
import { IconButton } from "@/components/ui/Button";
import { MenuSelect, type MenuSelectOption } from "@/components/ui/MenuSelect";
import { Modal } from "@/components/ui/Modal";
import { GlassTable, TableRow, TableCell, EmptyState } from "@/components/ui/GlassTable";
import {
  ArtistDistroTracksModal,
  type ArtistDistroTrackRow,
  type DistroPlaylist,
} from "@/components/catalog/ArtistDistroTracksModal";
import type { GraphNode, GraphEdge, SharedTrack, NetworkPlaylistOption } from "./page";

/** Co-artists from track credits (not graph edges). */
function trackScopedCoartistCount(n: GraphNode, basis: CollabCountBasis): number {
  const any = typeof n.co_artists_any_track === "number" ? n.co_artists_any_track : 0;
  const primary =
    typeof n.co_artists_primary_tracks === "number" ? n.co_artists_primary_tracks : 0;
  return basis === "primary_rows" ? primary : any;
}

// Force-graph uses Canvas/WebGL — must skip SSR.
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
}) as unknown as ForwardRefExoticComponent<
  ForceGraphProps<GraphNode, GraphEdge> &
    RefAttributes<ForceGraphMethods<GraphNode, GraphEdge>>
>;

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type FGNode = GraphNode;
type FGLink = GraphEdge;
type FGNodeObj = NodeObject<FGNode>;
type FGLinkObj = LinkObject<FGNode, FGLink>;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Pre-compute adjacency sets for fast highlight lookups. */
function buildAdjacency(edges: GraphEdge[]) {
  const neighbors = new Map<string, Set<string>>();
  const linksByKey = new Map<string, GraphEdge>();

  for (const e of edges) {
    if (!neighbors.has(e.source)) neighbors.set(e.source, new Set());
    if (!neighbors.has(e.target)) neighbors.set(e.target, new Set());
    neighbors.get(e.source)!.add(e.target);
    neighbors.get(e.target)!.add(e.source);
    linksByKey.set(`${e.source}__${e.target}`, e);
    linksByKey.set(`${e.target}__${e.source}`, e);
  }

  return { neighbors, linksByKey };
}

/** Scale a value within a range. */
function scaleLinear(val: number, min: number, max: number, outMin: number, outMax: number) {
  if (max === min) return (outMin + outMax) / 2;
  return outMin + ((val - min) / (max - min)) * (outMax - outMin);
}

/** Graph-space step with “nice” 1–2–5 spacing; `rawStep` ≈ desired spacing in graph units. */
function pickNiceGridStep(rawStep: number): number {
  if (!Number.isFinite(rawStep) || rawStep <= 0) return 40;
  const exp = Math.floor(Math.log10(rawStep));
  const base = 10 ** exp;
  const m = rawStep / base;
  const nice = m <= 1.5 ? 1 : m <= 3.5 ? 2 : m <= 7.5 ? 5 : 10;
  return nice * base;
}

/** Target on-screen spacing between major grid lines (px); cap line count for perf. */
const NETWORK_GRID_TARGET_PX = 34;
const NETWORK_GRID_MAX_LINES_PER_AXIS = 52;
/** Minor subdivisions (1/5 of major); only when spacing is comfortable and line count stays bounded. */
const NETWORK_GRID_MINOR_MIN_PX = 12;
const NETWORK_GRID_MINOR_MAX_PX = 30;
const NETWORK_GRID_MINOR_MAX_LINES_PER_AXIS = 56;

function nearGridMultiple(value: number, step: number): boolean {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return false;
  const q = value / step;
  return Math.abs(q - Math.round(q)) < 1e-5;
}

const LS_NETWORK_CAMERA = "sb:network:camera:v1";
/** Production site for Excel export links (catalog URLs, Summary page URL) — not the dev server origin. */
const SPOTIBASE_PUBLIC_ORIGIN = "https://spotibase.vercel.app";
const MAX_SEL_URL = 80;
const CAMERA_SAVE_MS = 450;
/** Match `TrackStreamsXYChart`: touch/pen hold before box-select; movement cancels (user is panning). */
const NETWORK_LONG_PRESS_MS = 550;
const NETWORK_LONG_PRESS_MOVE_PX = 10;

function readNetworkToggles(sp: URLSearchParams) {
  return {
    scaleByTracks: sp.get("scale_tracks") === "1",
    showImages: sp.get("images") !== "0",
  };
}

type CollabFilterMode = "le" | "ge";

/** What “co-artist count” means for the filter + export. */
type CollabCountBasis = "playlist" | "primary_rows";

function parseCollabCountBasis(sp: URLSearchParams): CollabCountBasis {
  const v = sp.get("co_basis")?.trim().toLowerCase();
  if (v === "primary" || v === "primary_rows" || v === "lead") return "primary_rows";
  return "playlist";
}

function parseCollabDegreeFilter(sp: URLSearchParams): { n: number | null; mode: CollabFilterMode } {
  const parseN = (raw: string | null): number | null => {
    if (raw == null || raw === "") return null;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 0 || n > 999) return null;
    return n;
  };
  const minN = parseN(sp.get("collab_min"));
  const maxN = parseN(sp.get("collab_max"));
  if (minN != null) return { n: minN, mode: "ge" };
  if (maxN != null) return { n: maxN, mode: "le" };
  return { n: null, mode: "le" };
}

/** Non-empty draft must be digits only; clamps to 0–999. */
function parseCollabInputDraft(trimmed: string): number | null {
  const t = trimmed.trim();
  if (t === "") return null;
  if (!/^\d+$/.test(t)) return null;
  const n = parseInt(t, 10);
  return Math.min(999, Math.max(0, n));
}

function buildNetworkQueryString(args: {
  playlistKey: string | null;
  hideNonPrimary: boolean;
  scaleByTracks: boolean;
  showImages: boolean;
  collabFilterN: number | null;
  collabFilterMode: CollabFilterMode;
  collabCountBasis: CollabCountBasis;
  selectedIds: string[];
}): string {
  const p = new URLSearchParams();
  if (args.playlistKey) p.set("playlist", args.playlistKey);
  if (args.hideNonPrimary) p.set("hide_non_primary", "1");
  if (args.scaleByTracks) p.set("scale_tracks", "1");
  if (!args.showImages) p.set("images", "0");
  if (args.collabFilterN != null) {
    if (args.collabFilterMode === "ge") p.set("collab_min", String(args.collabFilterN));
    else p.set("collab_max", String(args.collabFilterN));
  }
  if (args.collabCountBasis === "primary_rows") p.set("co_basis", "primary");
  if (args.selectedIds.length > 0 && args.selectedIds.length <= MAX_SEL_URL) {
    p.set("sel", args.selectedIds.join(","));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

function isTypingTarget(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return el.isContentEditable;
}

function linkEndpointId(end: unknown): string {
  if (end && typeof end === "object" && "id" in end) {
    return String((end as { id: string }).id);
  }
  return String(end);
}

/* ------------------------------------------------------------------ */
/*  Image cache (loads artist images for Canvas rendering)             */
/* ------------------------------------------------------------------ */

const imageCache = new Map<string, HTMLImageElement | "loading" | "error">();

function getImage(url: string): HTMLImageElement | null {
  const cached = imageCache.get(url);
  if (cached === "loading" || cached === "error") return null;
  if (cached) return cached;

  imageCache.set(url, "loading");
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = url;
  img.onload = () => imageCache.set(url, img);
  img.onerror = () => imageCache.set(url, "error");
  return null;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface Props {
  nodes: GraphNode[];
  edges: GraphEdge[];
  playlists: NetworkPlaylistOption[];
  playlistKey: string | null;
  hideNonPrimary: boolean;
}

export function NetworkGraphClient({
  nodes,
  edges,
  playlists,
  playlistKey,
  hideNonPrimary,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const colors = useThemeColors();
  const fgRef = useRef<ForceGraphMethods<FGNode, FGLink> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const cameraSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Controls (URL-synced toggles — see effects below)
  const [scaleByTracks, setScaleByTracks] = useState(() => readNetworkToggles(searchParams).scaleByTracks);
  const [showImages, setShowImages] = useState(() => readNetworkToggles(searchParams).showImages);
  const [collabFilterN, setCollabFilterN] = useState<number | null>(() =>
    parseCollabDegreeFilter(searchParams).n,
  );
  const [collabFilterMode, setCollabFilterMode] = useState<CollabFilterMode>(() =>
    parseCollabDegreeFilter(searchParams).mode,
  );
  const [collabInputDraft, setCollabInputDraft] = useState(() => {
    const { n } = parseCollabDegreeFilter(searchParams);
    return n == null ? "" : String(n);
  });
  const [collabCountBasis, setCollabCountBasis] = useState<CollabCountBasis>(() =>
    parseCollabCountBasis(searchParams),
  );
  const [boxSelectArmed, setBoxSelectArmed] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [tabHidden, setTabHidden] = useState(false);
  const [xlsxExporting, setXlsxExporting] = useState(false);
  const [xlsxExportPhase, setXlsxExportPhase] = useState<string | null>(null);
  const [xlsxExportAlert, setXlsxExportAlert] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  // Interaction state
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const selectedNodeIdRef = useRef<string | null>(null);
  selectedNodeIdRef.current = selectedNodeId;
  /** After playlist / hide-non-primary reload, center camera on kept single selection instead of zoom-to-fit. */
  const refocusSingleAfterGraphReloadRef = useRef(false);

  const [hoveredNode, setHoveredNode] = useState<FGNodeObj | null>(null);
  const [hoveredLink, setHoveredLink] = useState<FGLinkObj | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  const [distroModalOpen, setDistroModalOpen] = useState(false);
  const [distroLoading, setDistroLoading] = useState(false);
  const [distroError, setDistroError] = useState<string | null>(null);
  const [distroArtistName, setDistroArtistName] = useState("");
  const [distroPlaylists, setDistroPlaylists] = useState<DistroPlaylist[]>([]);
  const [distroTracks, setDistroTracks] = useState<ArtistDistroTrackRow[]>([]);
  const [distroNameMap, setDistroNameMap] = useState<Map<string, string>>(() => new Map());

  /** Alt+drag box selection (artist ids). */
  const [rangeSelection, setRangeSelection] = useState<string[]>([]);
  const [boxRect, setBoxRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const selectDragRef = useRef<{
    pointerId: number;
    x0: number;
    y0: number;
  } | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);
  const touchPointerDownRef = useRef(false);

  const clearNetworkLongPress = useCallback(() => {
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearNetworkLongPress(), [clearNetworkLongPress]);

  const [streamTotals, setStreamTotals] = useState<{
    total: number | null;
    daily: number | null;
    loading: boolean;
  }>({ total: null, daily: null, loading: false });

  const [selectionCollabsModalOpen, setSelectionCollabsModalOpen] = useState(false);

  // Container sizing
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setDimensions({ width: Math.floor(width), height: Math.floor(height) });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const r = readNetworkToggles(searchParams);
    setScaleByTracks(r.scaleByTracks);
    setShowImages(r.showImages);
    const cf = parseCollabDegreeFilter(searchParams);
    setCollabFilterN(cf.n);
    setCollabFilterMode(cf.mode);
    setCollabInputDraft(cf.n == null ? "" : String(cf.n));
    setCollabCountBasis(parseCollabCountBasis(searchParams));
  }, [searchParams]);

  useEffect(() => {
    const fn = () => {
      const hidden = document.visibilityState === "hidden";
      setTabHidden(hidden);
      const fg = fgRef.current;
      if (!fg) return;
      if (hidden) fg.pauseAnimation();
      else fg.resumeAnimation();
    };
    fn();
    document.addEventListener("visibilitychange", fn);
    return () => document.removeEventListener("visibilitychange", fn);
  }, []);

  const playlistScopeOptions = useMemo((): MenuSelectOption[] => {
    const catalogThumb = (
      <div
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[calc(var(--sb-radius)-6px)] text-[10px]"
        style={{ backgroundColor: "var(--sb-surface)", color: "var(--sb-muted)" }}
        aria-hidden
      >
        ★
      </div>
    );
    return [
      { value: "", label: "All catalog tracks", leading: catalogThumb },
      ...playlists.map((p) => ({
        value: p.playlist_key,
        label: p.display_name,
        leading: p.spotify_playlist_image_url ? (
          <NextImage
            src={p.spotify_playlist_image_url}
            alt=""
            width={24}
            height={24}
            className="h-6 w-6 shrink-0 rounded-[calc(var(--sb-radius)-6px)] object-cover"
          />
        ) : (
          <div
            className="h-6 w-6 shrink-0 rounded-[calc(var(--sb-radius)-6px)]"
            style={{ backgroundColor: "var(--sb-surface)" }}
            aria-hidden
          />
        ),
      })),
    ];
  }, [playlists]);

  const networkExportScopeLabel = useMemo(
    () =>
      playlistKey
        ? playlists.find((p) => p.playlist_key === playlistKey)?.display_name ?? playlistKey
        : "All catalog",
    [playlistKey, playlists],
  );

  const collabCountBasisLabel = useMemo(
    () =>
      collabCountBasis === "playlist"
        ? "Playlist credits (any appearance on scoped tracks)"
        : "Primary tracks only (other artists on tracks where this artist is lead)",
    [collabCountBasis],
  );

  const collabFilterExportLabel = useMemo(() => {
    if (collabFilterN == null) return "None";
    const base =
      collabFilterMode === "le"
        ? `≤${collabFilterN} (up to)`
        : `≥${collabFilterN} (at least)`;
    return `${base}; ${collabCountBasis === "playlist" ? "playlist-wide" : "primary rows"}`;
  }, [collabFilterN, collabFilterMode, collabCountBasis]);

  // Precompute adjacency
  const { neighbors } = useMemo(() => buildAdjacency(edges), [edges]);

  // Compute node size range
  const { minTrackCount, maxTrackCount } = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const n of nodes) {
      if (n.track_count < min) min = n.track_count;
      if (n.track_count > max) max = n.track_count;
    }
    return { minTrackCount: min, maxTrackCount: max };
  }, [nodes]);

  /** Graph edge degree (co-primary links only when hide-non-primary — can undercount). */
  const graphDegreeMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of edges) {
      map.set(e.source, (map.get(e.source) ?? 0) + 1);
      map.set(e.target, (map.get(e.target) ?? 0) + 1);
    }
    return map;
  }, [edges]);

  /** Distinct co-credited artists — basis picks playlist-wide vs primary-row-only. */
  const trackCollabFilterMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const node of nodes) {
      map.set(node.id, trackScopedCoartistCount(node, collabCountBasis));
    }
    return map;
  }, [nodes, collabCountBasis]);

  const visibleNodeIdsForCollab = useMemo(() => {
    if (collabFilterN === null) return null;
    const s = new Set<string>();
    for (const node of nodes) {
      const cnt = trackCollabFilterMap.get(node.id) ?? 0;
      const ok = collabFilterMode === "le" ? cnt <= collabFilterN : cnt >= collabFilterN;
      if (ok) s.add(node.id);
    }
    return s;
  }, [nodes, trackCollabFilterMap, collabFilterN, collabFilterMode]);

  const neighborsView = useMemo(() => {
    if (!visibleNodeIdsForCollab) return neighbors;
    const fe = edges.filter(
      (e) => visibleNodeIdsForCollab.has(e.source) && visibleNodeIdsForCollab.has(e.target),
    );
    return buildAdjacency(fe).neighbors;
  }, [neighbors, edges, visibleNodeIdsForCollab]);

  const collabDegreeMatchesFilter = useCallback(
    (deg: number) =>
      collabFilterN === null
        ? true
        : collabFilterMode === "le"
          ? deg <= collabFilterN
          : deg >= collabFilterN,
    [collabFilterN, collabFilterMode],
  );

  useEffect(() => {
    if (collabFilterN === null) return;
    setRangeSelection((prev) => {
      const next = prev.filter((id) =>
        collabDegreeMatchesFilter(trackCollabFilterMap.get(id) ?? 0),
      );
      return next.length === prev.length ? prev : next;
    });
    setSelectedNodeId((prev) => {
      if (!prev) return null;
      return collabDegreeMatchesFilter(trackCollabFilterMap.get(prev) ?? 0) ? prev : null;
    });
  }, [collabFilterN, collabFilterMode, trackCollabFilterMap, collabDegreeMatchesFilter]);

  const nodeIdKey = useMemo(
    () =>
      [...nodes]
        .map((n) => n.id)
        .sort()
        .join("\0"),
    [nodes],
  );

  const cameraScope = useMemo(
    () =>
      `${playlistKey ?? "all"}|${hideNonPrimary ? "1" : "0"}|${nodeIdKey}|c:${collabFilterMode}:${collabFilterN ?? "x"}|b:${collabCountBasis}`,
    [playlistKey, hideNonPrimary, nodeIdKey, collabFilterMode, collabFilterN, collabCountBasis],
  );

  const graphData = useMemo(() => {
    if (!visibleNodeIdsForCollab) {
      return {
        nodes: nodes.map((n) => ({ ...n })),
        links: edges.map((e) => ({ ...e })),
      };
    }
    const fnodes = nodes.filter((n) => visibleNodeIdsForCollab.has(n.id)).map((n) => ({ ...n }));
    const flinks = edges
      .filter((e) => visibleNodeIdsForCollab.has(e.source) && visibleNodeIdsForCollab.has(e.target))
      .map((e) => ({ ...e }));
    return { nodes: fnodes, links: flinks };
  }, [nodes, edges, visibleNodeIdsForCollab]);

  const handleExportViewXlsx = useCallback(async () => {
    setXlsxExporting(true);
    setXlsxExportAlert(null);
    setXlsxExportPhase("Preparing…");
    try {
      const scopeSlug = slugifyForFilename(networkExportScopeLabel);
      const isrcSet = new Set<string>();
      for (const e of graphData.links) {
        for (const t of e.shared_tracks ?? []) {
          const id = String(t.isrc ?? "").trim();
          if (id) isrcSet.add(id);
        }
      }
      const isrcList = [...isrcSet];
      const trackEnrichment = new Map<string, NetworkTrackSheetEnrichment>();
      const ISRC_BATCH = 3500;
      const ISRC_PARALLEL = 3;
      let trackEnrichmentBatchFailures = 0;

      const artistIdsForStats = graphData.nodes
        .map((n) => n.id)
        .filter((id) => String(id).trim().length > 0);

      const artistStreamStatsPromise = (async (): Promise<{
        map: Map<string, NetworkArtistStreamExportRow>;
        ok: boolean;
      }> => {
        if (!artistIdsForStats.length) {
          return { map: new Map(), ok: true };
        }
        try {
          const resStats = await fetch("/api/admin/network-export-artist-stream-stats", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              artistIds: artistIdsForStats,
              playlistKey: playlistKey ?? null,
              hideNonPrimary,
            }),
          });
          const js = (await resStats.json()) as {
            rows?: Array<{
              artist_id: string;
              total_streams_in_scope: number;
              daily_streams_in_scope: number;
              tracks_all_catalog: number;
              total_streams_all_catalog: number;
              daily_streams_all_catalog: number;
            }>;
            error?: string;
          };
          if (!resStats.ok || js.error) {
            console.error("network-export-artist-stream-stats:", js.error ?? resStats.statusText);
            return { map: new Map(), ok: false };
          }
          const map = new Map<string, NetworkArtistStreamExportRow>();
          for (const r of js.rows ?? []) {
            map.set(r.artist_id, {
              total_streams_in_scope: r.total_streams_in_scope,
              daily_streams_in_scope: r.daily_streams_in_scope,
              tracks_all_catalog: r.tracks_all_catalog,
              total_streams_all_catalog: r.total_streams_all_catalog,
              daily_streams_all_catalog: r.daily_streams_all_catalog,
            });
          }
          return { map, ok: true };
        } catch (e) {
          console.error("network-export-artist-stream-stats:", e);
          return { map: new Map(), ok: false };
        }
      })();

      const parts: string[][] = [];
      for (let i = 0; i < isrcList.length; i += ISRC_BATCH) {
        parts.push(isrcList.slice(i, i + ISRC_BATCH));
      }

      if (parts.length) {
        setXlsxExportPhase(`Track metadata 0/${parts.length}`);
      } else if (artistIdsForStats.length) {
        setXlsxExportPhase("Loading artist stream totals…");
      }

      let nextBatchIdx = 0;
      let completedBatches = 0;

      async function fetchOneIsrcBatch(part: string[]): Promise<void> {
        const res = await fetch("/api/admin/isrc-batch-details", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isrcs: part }),
        });
        const j = (await res.json()) as {
          tracks?: Array<{
            isrc: string;
            name: string | null;
            release_date: string | null;
            totalStreams: number | null;
            dailyStreams: number | null;
            artistsOnTrack?: string;
            distroPlaylists?: string;
            spotify_track_id?: string | null;
          }>;
          error?: string;
        };
        if (!res.ok || j.error) {
          trackEnrichmentBatchFailures += 1;
          console.error("isrc-batch-details for export:", j.error ?? res.statusText);
          return;
        }
        for (const t of j.tracks ?? []) {
          const sid = t.spotify_track_id;
          trackEnrichment.set(t.isrc, {
            catalogName: t.name,
            artistsOnTrack: t.artistsOnTrack ?? "",
            totalStreams: t.totalStreams ?? null,
            dailyStreams: t.dailyStreams ?? null,
            releaseDate: t.release_date,
            distroPlaylists: t.distroPlaylists ?? "",
            spotifyTrackId: typeof sid === "string" && sid.trim() ? sid.trim() : null,
          });
        }
      }

      async function isrcWorker(): Promise<void> {
        while (true) {
          const i = nextBatchIdx++;
          if (i >= parts.length) break;
          await fetchOneIsrcBatch(parts[i]!);
          completedBatches += 1;
          setXlsxExportPhase(`Track metadata ${completedBatches}/${parts.length}`);
        }
      }

      const workerCount = parts.length === 0 ? 0 : Math.min(ISRC_PARALLEL, parts.length);
      await Promise.all(Array.from({ length: workerCount }, () => isrcWorker()));

      setXlsxExportPhase("Finishing data…");
      const { map: artistStreamStatsById, ok: artistStreamStatsOk } = await artistStreamStatsPromise;

      setXlsxExportPhase("Building spreadsheet…");
      const qs = searchParams.toString();
      const pageUrl = `${SPOTIBASE_PUBLIC_ORIGIN}${pathname || ""}${qs ? `?${qs}` : ""}`;
      const exportOrigin = SPOTIBASE_PUBLIC_ORIGIN;

      await downloadNetworkViewXlsx({
        meta: {
          scopeLabel: networkExportScopeLabel,
          hideNonPrimary,
          collabFilterLabel: collabFilterExportLabel,
          collabCountBasisLabel,
          exportedAtIso: new Date().toISOString(),
          pageUrl,
          fullGraphArtistCount: nodes.length,
          fullGraphCollaborationCount: edges.length,
          trackEnrichmentIsrcRequested: isrcList.length,
          trackEnrichmentIsrcLoaded: trackEnrichment.size,
          trackEnrichmentBatchFailures,
        },
        viewNodes: graphData.nodes.map((n) => ({
          id: n.id,
          name: n.name,
          track_count: n.track_count,
        })),
        viewEdges: graphData.links as unknown as NetworkViewExportEdge[],
        fullEdges: edges as unknown as NetworkViewExportEdge[],
        fullArtistNameById: new Map(nodes.map((n) => [n.id, n.name])),
        fullCollabCountById: trackCollabFilterMap,
        filenameBase: `network_${scopeSlug}_${todayIsoDate()}`,
        exportOrigin,
        trackEnrichment,
        artistStreamStatsById,
      });

      const issues: string[] = [];
      if (trackEnrichmentBatchFailures > 0) {
        issues.push(
          `${trackEnrichmentBatchFailures} track metadata batch request(s) failed`,
        );
      }
      if (!artistStreamStatsOk && artistIdsForStats.length > 0) {
        issues.push("Artist stream totals could not be loaded");
      }
      if (issues.length) {
        setXlsxExportAlert(
          `${issues.join(". ")}. The file still downloaded; check the Summary sheet and empty columns.`,
        );
      }
    } catch (err) {
      console.error("network xlsx export failed:", err);
      setXlsxExportAlert("Export failed. Check the console and try again.");
    } finally {
      setXlsxExporting(false);
      setXlsxExportPhase(null);
    }
  }, [
    networkExportScopeLabel,
    hideNonPrimary,
    collabFilterExportLabel,
    graphData.nodes,
    graphData.links,
    edges,
    nodes,
    trackCollabFilterMap,
    pathname,
    searchParams,
    playlistKey,
    collabCountBasisLabel,
  ]);

  const selectionHydrateKey = useMemo(
    () => `${nodeIdKey}\0${searchParams.get("sel") ?? ""}`,
    [nodeIdKey, searchParams],
  );

  const rangeSet = useMemo(() => new Set(rangeSelection), [rangeSelection]);

  const pushNetworkUrl = useCallback(
    (patch: Partial<{
      playlistKey: string | null;
      hideNonPrimary: boolean;
      scaleByTracks: boolean;
      showImages: boolean;
      collabFilterN: number | null;
      collabFilterMode: CollabFilterMode;
      collabCountBasis: CollabCountBasis;
      selectedIds: string[];
    }>) => {
      const q = buildNetworkQueryString({
        playlistKey: patch.playlistKey ?? playlistKey,
        hideNonPrimary: patch.hideNonPrimary ?? hideNonPrimary,
        scaleByTracks: patch.scaleByTracks ?? scaleByTracks,
        showImages: patch.showImages ?? showImages,
        collabFilterN: patch.collabFilterN !== undefined ? patch.collabFilterN : collabFilterN,
        collabFilterMode: patch.collabFilterMode ?? collabFilterMode,
        collabCountBasis: patch.collabCountBasis ?? collabCountBasis,
        selectedIds: patch.selectedIds ?? rangeSelection,
      });
      router.replace((pathname || "/network") + q, { scroll: false });
    },
    [
      pathname,
      router,
      playlistKey,
      hideNonPrimary,
      scaleByTracks,
      showImages,
      collabFilterN,
      collabFilterMode,
      collabCountBasis,
      rangeSelection,
    ],
  );

  const prevSelectionHydrateKey = useRef("");
  useEffect(() => {
    if (prevSelectionHydrateKey.current === selectionHydrateKey) return;
    prevSelectionHydrateKey.current = selectionHydrateKey;
    const sel = searchParams.get("sel");
    const setId = new Set(nodes.map((n) => n.id));
    if (!sel?.trim()) {
      setRangeSelection([]);
      return;
    }
    setRangeSelection(sel.split(",").map((s) => s.trim()).filter((id) => setId.has(id)));
  }, [selectionHydrateKey, nodes, searchParams]);

  useEffect(() => {
    const q = buildNetworkQueryString({
      playlistKey,
      hideNonPrimary,
      scaleByTracks,
      showImages,
      collabFilterN,
      collabFilterMode,
      collabCountBasis,
      selectedIds: rangeSelection,
    });
    const nextPath = (pathname || "/network") + q;
    const t = setTimeout(() => {
      if (typeof window === "undefined") return;
      const cur = `${pathname}${window.location.search}`;
      if (nextPath === cur) return;
      router.replace(nextPath, { scroll: false });
    }, 200);
    return () => clearTimeout(t);
  }, [
    rangeSelection,
    scaleByTracks,
    showImages,
    collabFilterN,
    collabFilterMode,
    collabCountBasis,
    playlistKey,
    hideNonPrimary,
    pathname,
    router,
  ]);

  const scheduleCameraSave = useCallback(() => {
    if (cameraSaveTimerRef.current) clearTimeout(cameraSaveTimerRef.current);
    cameraSaveTimerRef.current = setTimeout(() => {
      cameraSaveTimerRef.current = null;
      const fg = fgRef.current;
      if (!fg) return;
      try {
        const k = fg.zoom();
        const c = fg.centerAt();
        localStorage.setItem(
          LS_NETWORK_CAMERA,
          JSON.stringify({ scope: cameraScope, k, cx: c.x, cy: c.y }),
        );
      } catch {
        // ignore quota / private mode
      }
    }, CAMERA_SAVE_MS);
  }, [cameraScope]);

  useEffect(() => {
    return () => {
      if (cameraSaveTimerRef.current) clearTimeout(cameraSaveTimerRef.current);
    };
  }, []);

  const rangeStats = useMemo(() => {
    if (rangeSelection.length < 2) {
      return {
        internalEdges: [] as GraphEdge[],
        unionIsrcs: [] as string[],
        weightSum: 0,
      };
    }
    const rs = new Set(rangeSelection);
    const internalEdges = edges.filter((e) => rs.has(e.source) && rs.has(e.target));
    const isrcs = new Set<string>();
    let weightSum = 0;
    for (const e of internalEdges) {
      weightSum += e.weight ?? 0;
      for (const t of e.shared_tracks ?? []) {
        if (t.isrc) isrcs.add(t.isrc);
      }
    }
    return { internalEdges, unionIsrcs: [...isrcs], weightSum };
  }, [edges, rangeSelection]);

  useEffect(() => {
    const list = rangeStats.unionIsrcs;
    if (list.length === 0) {
      setStreamTotals({ total: null, daily: null, loading: false });
      return;
    }
    let cancelled = false;
    setStreamTotals((s) => ({ ...s, loading: true }));
    fetch("/api/admin/isrc-stream-totals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isrcs: list }),
    })
      .then((r) => r.json())
      .then((j: { totalStreams?: unknown; dailyStreams?: unknown }) => {
        if (cancelled) return;
        setStreamTotals({
          total: typeof j.totalStreams === "number" ? j.totalStreams : null,
          daily: typeof j.dailyStreams === "number" ? j.dailyStreams : null,
          loading: false,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setStreamTotals({ total: null, daily: null, loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [rangeStats.unionIsrcs]);

  useEffect(() => {
    if (rangeSelection.length === 0) setSelectionCollabsModalOpen(false);
  }, [rangeSelection.length]);

  // Search results
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    let list = nodes.filter((n) => n.name.toLowerCase().includes(q));
    if (visibleNodeIdsForCollab) {
      list = list.filter((n) => visibleNodeIdsForCollab.has(n.id));
    }
    return list.slice(0, 12);
  }, [nodes, searchQuery, visibleNodeIdsForCollab]);

  // Is a node highlighted?
  const isHighlighted = useCallback(
    (nodeId: string) => {
      if (rangeSet.size > 0) return rangeSet.has(nodeId);
      if (!selectedNodeId) return true;
      if (nodeId === selectedNodeId) return true;
      return neighborsView.get(selectedNodeId)?.has(nodeId) ?? false;
    },
    [rangeSet, selectedNodeId, neighborsView],
  );

  // Is a link highlighted?
  const isLinkHighlighted = useCallback(
    (link: FGLinkObj) => {
      const srcId = linkEndpointId(link.source);
      const tgtId = linkEndpointId(link.target);
      if (rangeSet.size >= 2) {
        return rangeSet.has(srcId) && rangeSet.has(tgtId);
      }
      if (!selectedNodeId) return true;
      return srcId === selectedNodeId || tgtId === selectedNodeId;
    },
    [rangeSet, selectedNodeId],
  );

  /* -------- Node rendering -------- */

  const nodeVal = useCallback(
    (node: FGNodeObj) => {
      if (!scaleByTracks) return 2;
      return scaleLinear(node.track_count ?? 1, minTrackCount, maxTrackCount, 1, 12);
    },
    [scaleByTracks, minTrackCount, maxTrackCount],
  );

  const nodeCanvasObject = useCallback(
    (node: FGNodeObj, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const id = node.id as string;
      const highlighted = isHighlighted(id);
      const alpha = highlighted ? 1 : 0.12;
      const inRange = rangeSet.size > 0 && rangeSet.has(id);

      const baseSize = scaleByTracks
        ? scaleLinear(node.track_count ?? 1, minTrackCount, maxTrackCount, 3, 16)
        : 5;
      const size = baseSize;

      const x = node.x ?? 0;
      const y = node.y ?? 0;

      ctx.save();
      ctx.globalAlpha = alpha;

      // Draw image or circle
      const img = showImages && node.image_url ? getImage(node.image_url) : null;
      if (img) {
        ctx.beginPath();
        ctx.arc(x, y, size, 0, 2 * Math.PI);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(img, x - size, y - size, size * 2, size * 2);
        // Border ring
        ctx.restore();
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, 2 * Math.PI);
        ctx.strokeStyle = colors.accent;
        ctx.lineWidth = 1.2 / globalScale;
        ctx.stroke();
      } else {
        // Solid circle
        ctx.beginPath();
        ctx.arc(x, y, size, 0, 2 * Math.PI);
        ctx.fillStyle =
          id === selectedNodeId || inRange ? colors.accent : colors.accentStroke;
        ctx.fill();

        // Subtle glow for selected
        if (id === selectedNodeId || inRange) {
          ctx.shadowColor = colors.accent;
          ctx.shadowBlur = 12;
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }

      if (inRange) {
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(x, y, size + 2.5 / globalScale, 0, 2 * Math.PI);
        ctx.strokeStyle = colors.accent;
        ctx.lineWidth = 2 / globalScale;
        ctx.stroke();
      }

      // Label (show when zoomed in or when highlighted)
      const showLabel =
        globalScale > 1.8 ||
        id === selectedNodeId ||
        inRange ||
        id === (hoveredNode?.id as string);
      if (showLabel && highlighted) {
        const label = node.name ?? id;
        const fontSize = Math.max(10 / globalScale, 2);
        ctx.font = `${fontSize}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = colors.text;
        ctx.globalAlpha = alpha * 0.9;
        ctx.fillText(label, x, y + size + 2 / globalScale);
      }

      ctx.restore();
    },
    [
      isHighlighted,
      scaleByTracks,
      showImages,
      minTrackCount,
      maxTrackCount,
      selectedNodeId,
      hoveredNode,
      colors,
      rangeSet,
    ],
  );

  // Hit area for pointer
  const nodePointerAreaPaint = useCallback(
    (node: FGNodeObj, color: string, ctx: CanvasRenderingContext2D) => {
      const size = scaleByTracks
        ? scaleLinear(node.track_count ?? 1, minTrackCount, maxTrackCount, 3, 16)
        : 5;
      const hitSize = Math.max(size, 6);
      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, hitSize, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
    },
    [scaleByTracks, minTrackCount, maxTrackCount],
  );

  /* -------- Link rendering -------- */

  const linkWidth = useCallback(
    (link: FGLinkObj) => {
      const w = (link as unknown as GraphEdge).weight ?? 1;
      return Math.min(w * 0.8, 6);
    },
    [],
  );

  const linkColor = useCallback(
    (link: FGLinkObj) => {
      const hl = isLinkHighlighted(link);
      if (!hl) return colors.isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)";
      const w = (link as unknown as GraphEdge).weight ?? 1;
      const a = Math.min(0.15 + w * 0.1, 0.6);
      return colors.isDark
        ? `rgba(212,255,77,${a})`
        : `rgba(168,214,46,${a})`;
    },
    [isLinkHighlighted, colors],
  );

  /** World-space grid (pans/zooms with the graph) for spatial reference while navigating. */
  const onRenderFramePre = useCallback(
    (ctx: CanvasRenderingContext2D, globalScale: number) => {
      const fg = fgRef.current;
      const w = dimensions.width;
      const h = dimensions.height;
      if (!fg || w < 8 || h < 8 || !Number.isFinite(globalScale) || globalScale < 0.001) return;

      let tl: { x: number; y: number };
      let br: { x: number; y: number };
      try {
        tl = fg.screen2GraphCoords(0, 0);
        br = fg.screen2GraphCoords(w, h);
      } catch {
        return;
      }

      let minX = Math.min(tl.x, br.x);
      let maxX = Math.max(tl.x, br.x);
      let minY = Math.min(tl.y, br.y);
      let maxY = Math.max(tl.y, br.y);

      let step = pickNiceGridStep(NETWORK_GRID_TARGET_PX / globalScale);
      const spanX = maxX - minX;
      const spanY = maxY - minY;
      for (let i = 0; i < 24; i++) {
        if (
          !(spanX > 0 && spanX / step > NETWORK_GRID_MAX_LINES_PER_AXIS) &&
          !(spanY > 0 && spanY / step > NETWORK_GRID_MAX_LINES_PER_AXIS)
        ) {
          break;
        }
        step *= 2;
      }
      for (let i = 0; i < 24; i++) {
        if (!(spanX > 0 && spanY > 0 && spanX / step < 5 && spanY / step < 5)) break;
        step /= 2;
      }
      step = Math.max(step, 1e-8);

      const pad = step;
      minX -= pad;
      maxX += pad;
      minY -= pad;
      maxY += pad;

      const startX = Math.floor(minX / step) * step;
      const startY = Math.floor(minY / step) * step;
      const eps = step * 1e-9;

      const baseAlpha = colors.isDark ? 0.055 : 0.048;
      const zoomBoost = Math.min(1.2, Math.max(0.58, 0.58 + globalScale * 0.14));
      const majorAlpha = Math.min(0.085, baseAlpha * zoomBoost);
      const majorStroke = colors.isDark
        ? `rgba(255,255,255,${majorAlpha})`
        : `rgba(0,0,0,${majorAlpha})`;

      const hairline = Math.max(0.55 / globalScale, 0.0008);

      ctx.save();
      ctx.lineCap = "square";

      const sub = step / 5;
      const minorPx = sub * globalScale;
      const estMinorX = spanX / sub;
      const estMinorY = spanY / sub;
      const drawMinor =
        minorPx >= NETWORK_GRID_MINOR_MIN_PX &&
        minorPx <= NETWORK_GRID_MINOR_MAX_PX &&
        estMinorX <= NETWORK_GRID_MINOR_MAX_LINES_PER_AXIS &&
        estMinorY <= NETWORK_GRID_MINOR_MAX_LINES_PER_AXIS;

      if (drawMinor) {
        const minorAlpha = majorAlpha * 0.38;
        const minorStroke = colors.isDark
          ? `rgba(255,255,255,${minorAlpha})`
          : `rgba(0,0,0,${minorAlpha})`;
        const subStartX = Math.floor(minX / sub) * sub;
        const subStartY = Math.floor(minY / sub) * sub;
        const subEps = sub * 1e-9;
        const dash = Math.max(2.2 / globalScale, 0.001);

        ctx.strokeStyle = minorStroke;
        ctx.lineWidth = Math.max(0.48 / globalScale, 0.0006);
        ctx.setLineDash([dash, dash * 1.15]);

        ctx.beginPath();
        for (let gx = subStartX; gx <= maxX + subEps; gx += sub) {
          if (nearGridMultiple(gx, step)) continue;
          ctx.moveTo(gx, minY);
          ctx.lineTo(gx, maxY);
        }
        ctx.stroke();

        ctx.beginPath();
        for (let gy = subStartY; gy <= maxY + subEps; gy += sub) {
          if (nearGridMultiple(gy, step)) continue;
          ctx.moveTo(minX, gy);
          ctx.lineTo(maxX, gy);
        }
        ctx.stroke();

        ctx.setLineDash([]);
      }

      ctx.strokeStyle = majorStroke;
      ctx.lineWidth = hairline;

      ctx.beginPath();
      for (let gx = startX; gx <= maxX + eps; gx += step) {
        ctx.moveTo(gx, minY);
        ctx.lineTo(gx, maxY);
      }
      ctx.stroke();

      ctx.beginPath();
      for (let gy = startY; gy <= maxY + eps; gy += step) {
        ctx.moveTo(minX, gy);
        ctx.lineTo(maxX, gy);
      }
      ctx.stroke();

      const originAlpha = Math.min(0.11, majorAlpha * 1.55);
      const originStroke = colors.isDark
        ? `rgba(255,255,255,${originAlpha})`
        : `rgba(0,0,0,${originAlpha})`;
      ctx.strokeStyle = originStroke;
      ctx.lineWidth = Math.max(0.72 / globalScale, 0.001);

      if (minX <= 0 && maxX >= 0) {
        ctx.beginPath();
        ctx.moveTo(0, minY);
        ctx.lineTo(0, maxY);
        ctx.stroke();
      }
      if (minY <= 0 && maxY >= 0) {
        ctx.beginPath();
        ctx.moveTo(minX, 0);
        ctx.lineTo(maxX, 0);
        ctx.stroke();
      }

      ctx.restore();
    },
    [dimensions.width, dimensions.height, colors.isDark],
  );

  const closeDistroModal = useCallback(() => {
    setDistroModalOpen(false);
    setDistroLoading(false);
    setDistroError(null);
    setDistroPlaylists([]);
    setDistroTracks([]);
    setDistroNameMap(new Map());
  }, []);

  const openArtistDistroModal = useCallback(async (artistId: string, fallbackName: string) => {
    setDistroModalOpen(true);
    setDistroLoading(true);
    setDistroError(null);
    setDistroArtistName(fallbackName);
    setDistroPlaylists([]);
    setDistroTracks([]);
    setDistroNameMap(new Map());
    try {
      const res = await fetch(
        `/api/admin/artist-distro-tracks?artist_id=${encodeURIComponent(artistId)}`,
      );
      const json = (await res.json()) as {
        error?: string;
        artistName?: string;
        playlists?: DistroPlaylist[];
        tracks?: ArtistDistroTrackRow[];
        nameByArtistId?: Record<string, string>;
      };
      if (!res.ok) {
        throw new Error(json.error ?? "Failed to load");
      }
      setDistroArtistName(
        typeof json.artistName === "string" ? json.artistName : fallbackName,
      );
      setDistroPlaylists(Array.isArray(json.playlists) ? json.playlists : []);
      setDistroTracks(Array.isArray(json.tracks) ? json.tracks : []);
      setDistroNameMap(new Map(Object.entries(json.nameByArtistId ?? {})));
    } catch (e) {
      setDistroError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setDistroLoading(false);
    }
  }, []);

  /* -------- Interactions -------- */

  const handleNodeClick = useCallback(
    (node: FGNodeObj, event: MouseEvent) => {
      const id = node.id as string;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        event.stopPropagation();
        void openArtistDistroModal(id, String(node.name ?? id));
        return;
      }
      setRangeSelection([]);
      if (selectedNodeId === id) {
        setSelectedNodeId(null);
      } else {
        setSelectedNodeId(id);
        fgRef.current?.centerAt(node.x, node.y, 600);
        fgRef.current?.zoom(3, 600);
      }
    },
    [selectedNodeId, openArtistDistroModal],
  );

  const handleBackgroundClick = useCallback(() => {
    setSelectedNodeId(null);
    setRangeSelection([]);
  }, []);

  const onBoxPointerDownCapture = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const host = containerRef.current;
      if (!host) return;
      const r = host.getBoundingClientRect();
      if (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      ) {
        return;
      }

      const pt = e.pointerType;

      // Mouse: Alt or "Select region" — immediate box drag (blocks default pan on this gesture).
      if (pt === "mouse") {
        if (!e.altKey && !boxSelectArmed) return;
        clearNetworkLongPress();
        e.preventDefault();
        e.stopPropagation();
        selectDragRef.current = { pointerId: e.pointerId, x0: e.clientX, y0: e.clientY };
        try {
          host.setPointerCapture(e.pointerId);
        } catch {
          // ignore
        }
        setBoxRect({
          left: e.clientX - r.left,
          top: e.clientY - r.top,
          width: 0,
          height: 0,
        });
        return;
      }

      // Touch / pen: drag pans/zooms the graph. Box select = hold still (same timing as home scatter chart),
      // or use "Select region" for an immediate marquee without waiting.
      if (pt === "touch" || pt === "pen") {
        if (boxSelectArmed) {
          clearNetworkLongPress();
          e.preventDefault();
          e.stopPropagation();
          selectDragRef.current = { pointerId: e.pointerId, x0: e.clientX, y0: e.clientY };
          try {
            host.setPointerCapture(e.pointerId);
          } catch {
            // ignore
          }
          setBoxRect({
            left: e.clientX - r.left,
            top: e.clientY - r.top,
            width: 0,
            height: 0,
          });
          return;
        }

        clearNetworkLongPress();
        touchPointerDownRef.current = true;
        longPressStartRef.current = { x: e.clientX, y: e.clientY };
        const pid = e.pointerId;
        longPressTimerRef.current = window.setTimeout(() => {
          longPressTimerRef.current = null;
          if (!touchPointerDownRef.current) return;
          const start = longPressStartRef.current;
          if (!start) return;
          const h = containerRef.current;
          if (!h) return;
          try {
            void navigator.vibrate?.(25);
          } catch {
            // ignore
          }
          longPressStartRef.current = null;
          selectDragRef.current = { pointerId: pid, x0: start.x, y0: start.y };
          try {
            h.setPointerCapture(pid);
          } catch {
            // ignore
          }
          const br = h.getBoundingClientRect();
          setBoxRect({
            left: start.x - br.left,
            top: start.y - br.top,
            width: 0,
            height: 0,
          });
        }, NETWORK_LONG_PRESS_MS);
      }
    },
    [boxSelectArmed, clearNetworkLongPress],
  );

  const onBoxPointerMoveCapture = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const d = selectDragRef.current;
      if (d && e.pointerId === d.pointerId) {
        e.preventDefault();
        e.stopPropagation();
        const host = containerRef.current;
        if (!host) return;
        const r = host.getBoundingClientRect();
        const x1 = e.clientX;
        const y1 = e.clientY;
        setBoxRect({
          left: Math.min(d.x0, x1) - r.left,
          top: Math.min(d.y0, y1) - r.top,
          width: Math.abs(x1 - d.x0),
          height: Math.abs(y1 - d.y0),
        });
        return;
      }

      if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
      if (longPressTimerRef.current == null) return;
      const start = longPressStartRef.current;
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (Math.hypot(dx, dy) > NETWORK_LONG_PRESS_MOVE_PX) {
        clearNetworkLongPress();
        longPressStartRef.current = null;
      }
    },
    [clearNetworkLongPress],
  );

  const finalizeBoxSelect = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const d = selectDragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      const host = containerRef.current;
      const fg = fgRef.current;
      selectDragRef.current = null;
      setBoxRect(null);
      if (host) {
        try {
          host.releasePointerCapture(e.pointerId);
        } catch {
          // ignore
        }
      }
      if (!fg || !host) return;

      const r = host.getBoundingClientRect();
      const x0 = Math.min(d.x0, e.clientX);
      const x1 = Math.max(d.x0, e.clientX);
      const y0 = Math.min(d.y0, e.clientY);
      const y1 = Math.max(d.y0, e.clientY);

      if (x1 - x0 < 6 || y1 - y0 < 6) return;

      e.preventDefault();
      e.stopPropagation();

      const ga = fg.screen2GraphCoords(x0 - r.left, y0 - r.top);
      const gb = fg.screen2GraphCoords(x1 - r.left, y1 - r.top);
      const minGx = Math.min(ga.x, gb.x);
      const maxGx = Math.max(ga.x, gb.x);
      const minGy = Math.min(ga.y, gb.y);
      const maxGy = Math.max(ga.y, gb.y);

      const picked: string[] = [];
      for (const n of graphData.nodes as FGNodeObj[]) {
        const nx = n.x ?? 0;
        const ny = n.y ?? 0;
        if (nx >= minGx && nx <= maxGx && ny >= minGy && ny <= maxGy) {
          picked.push(String(n.id));
        }
      }
      picked.sort();
      setRangeSelection(picked);
      setSelectedNodeId(null);
      if (
        boxSelectArmed &&
        typeof window !== "undefined" &&
        window.matchMedia("(pointer: coarse)").matches
      ) {
        setBoxSelectArmed(false);
      }
    },
    [graphData.nodes, boxSelectArmed],
  );

  const onBoxPointerUpCapture = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      touchPointerDownRef.current = false;
      clearNetworkLongPress();
      longPressStartRef.current = null;
      finalizeBoxSelect(e);
    },
    [clearNetworkLongPress, finalizeBoxSelect],
  );

  const onBoxPointerCancelCapture = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      touchPointerDownRef.current = false;
      clearNetworkLongPress();
      longPressStartRef.current = null;
      if (selectDragRef.current?.pointerId !== e.pointerId) return;
      selectDragRef.current = null;
      setBoxRect(null);
      const host = containerRef.current;
      if (host) {
        try {
          host.releasePointerCapture(e.pointerId);
        } catch {
          // ignore
        }
      }
    },
    [clearNetworkLongPress],
  );

  const handleNodeHover = useCallback(
    (node: FGNodeObj | null, _prev: FGNodeObj | null) => {
      setHoveredNode(node);
      if (!node) {
        setTooltipPos(null);
      }
    },
    [],
  );

  const handleLinkHover = useCallback(
    (link: FGLinkObj | null, _prev: FGLinkObj | null) => {
      setHoveredLink(link);
      if (!link) {
        setTooltipPos(null);
      }
    },
    [],
  );

  // Track mouse position for tooltip
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    };
    el.addEventListener("mousemove", onMove);
    return () => el.removeEventListener("mousemove", onMove);
  }, []);

  /* -------- Search focus -------- */

  const focusOnArtist = useCallback(
    (artistId: string) => {
      const node = graphData.nodes.find((n) => n.id === artistId);
      if (!node) return;
      setSelectedNodeId(artistId);
      setSearchQuery("");
      setSearchOpen(false);
      // `react-force-graph-2d` injects simulation coordinates (`x`, `y`) at runtime.
      // Our `GraphNode` type doesn't include them, so we cast to the force-graph node type.
      const fgNode = node as unknown as FGNodeObj;
      const x = typeof fgNode.x === "number" ? fgNode.x : 0;
      const y = typeof fgNode.y === "number" ? fgNode.y : 0;
      fgRef.current?.centerAt(x, y, 800);
      fgRef.current?.zoom(4, 800);
    },
    [graphData.nodes],
  );

  /* -------- Reset -------- */

  const handleReset = useCallback(() => {
    try {
      localStorage.removeItem(LS_NETWORK_CAMERA);
    } catch {
      // ignore
    }
    setSelectedNodeId(null);
    setRangeSelection([]);
    setSearchQuery("");
    setCollabFilterN(null);
    setCollabFilterMode("le");
    setCollabInputDraft("");
    setCollabCountBasis("playlist");
    pushNetworkUrl({
      selectedIds: [],
      collabFilterN: null,
      collabFilterMode: "le",
      collabCountBasis: "playlist",
    });
    fgRef.current?.zoomToFit(600, 40);
  }, [pushNetworkUrl]);

  /* -------- Initial zoom-to-fit -------- */

  const hasZoomed = useRef(false);
  useEffect(() => {
    hasZoomed.current = false;
    setBoxRect(null);

    const prevSel = selectedNodeIdRef.current;
    const keepSel = Boolean(prevSel && nodes.some((n) => n.id === prevSel));
    refocusSingleAfterGraphReloadRef.current = keepSel;
    setSelectedNodeId(keepSel ? prevSel : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nodeIdKey tracks graph identity; nodes ref churns without composition change
  }, [playlistKey, hideNonPrimary, nodeIdKey, collabFilterN, collabFilterMode, collabCountBasis]);

  const onEngineStop = useCallback(() => {
    if (hasZoomed.current) return;

    const tryRefocus =
      refocusSingleAfterGraphReloadRef.current && selectedNodeIdRef.current;
    if (tryRefocus) {
      const id = selectedNodeIdRef.current;
      const n = graphData.nodes.find((node) => node.id === id) as FGNodeObj | undefined;
      const x = n?.x;
      const y = n?.y;
      if (n && typeof x === "number" && typeof y === "number") {
        refocusSingleAfterGraphReloadRef.current = false;
        hasZoomed.current = true;
        fgRef.current?.centerAt(x, y, 500);
        fgRef.current?.zoom(3, 500);
        return;
      }
    }

    const fg = fgRef.current;
    if (fg) {
      try {
        const raw = localStorage.getItem(LS_NETWORK_CAMERA);
        if (raw) {
          const p = JSON.parse(raw) as { scope?: string; k?: number; cx?: number; cy?: number };
          if (
            p.scope === cameraScope &&
            typeof p.k === "number" &&
            Number.isFinite(p.k) &&
            typeof p.cx === "number" &&
            typeof p.cy === "number" &&
            Number.isFinite(p.cx) &&
            Number.isFinite(p.cy)
          ) {
            hasZoomed.current = true;
            refocusSingleAfterGraphReloadRef.current = false;
            fg.zoom(p.k, 0);
            fg.centerAt(p.cx, p.cy, 0);
            return;
          }
        }
      } catch {
        // ignore
      }
    }

    hasZoomed.current = true;
    refocusSingleAfterGraphReloadRef.current = false;
    fgRef.current?.zoomToFit(400, 40);
  }, [graphData.nodes, cameraScope]);

  /* -------- Tooltip content -------- */

  const tooltipContent = useMemo(() => {
    if (hoveredNode) {
      const n = hoveredNode as FGNode;
      const id = n.id as string;
      const coTracks = trackCollabFilterMap.get(id) ?? trackScopedCoartistCount(n, collabCountBasis);
      const gDeg = graphDegreeMap.get(id) ?? 0;
      const coOther =
        collabCountBasis === "playlist"
          ? trackScopedCoartistCount(n, "primary_rows")
          : trackScopedCoartistCount(n, "playlist");
      return (
        <div className="space-y-1">
          <div className="font-semibold text-sm" style={{ color: colors.accent }}>
            {n.name}
          </div>
          <div className="text-xs" style={{ color: colors.muted }}>
            {n.track_count} track{n.track_count !== 1 ? "s" : ""} &middot;{" "}
            {coTracks} co-artist{coTracks !== 1 ? "s" : ""}{" "}
            {collabCountBasis === "playlist" ? "(playlist-wide)" : "(primary rows only)"}
          </div>
          {coOther !== coTracks ? (
            <div className="text-[10px] leading-snug" style={{ color: colors.muted }}>
              Other basis: {coOther}
            </div>
          ) : null}
          {hideNonPrimary && gDeg !== coTracks ? (
            <div className="text-[10px] leading-snug" style={{ color: colors.muted }}>
              Graph links: {gDeg} (edges only between artists who are both primary somewhere in scope)
            </div>
          ) : null}
        </div>
      );
    }
    if (hoveredLink) {
      const link = hoveredLink as unknown as GraphEdge;
      const srcNode = typeof hoveredLink.source === "object"
        ? (hoveredLink.source as FGNodeObj)
        : null;
      const tgtNode = typeof hoveredLink.target === "object"
        ? (hoveredLink.target as FGNodeObj)
        : null;
      const srcName = srcNode?.name ?? link.source;
      const tgtName = tgtNode?.name ?? link.target;
      const tracks = (link.shared_tracks ?? []) as SharedTrack[];

      return (
        <div className="space-y-1.5">
          <div className="text-xs font-semibold" style={{ color: colors.accent }}>
            {srcName} &times; {tgtName}
          </div>
          <div className="text-xs" style={{ color: colors.muted }}>
            {tracks.length} shared track{tracks.length !== 1 ? "s" : ""}
          </div>
          {tracks.length > 0 && (
            <ul className="text-xs space-y-0.5 max-h-[140px] overflow-y-auto" style={{ color: colors.text }}>
              {tracks.slice(0, 10).map((t, i) => (
                <li key={i} className="truncate max-w-[240px]">
                  &bull; {t.name ?? t.isrc}
                </li>
              ))}
              {tracks.length > 10 && (
                <li style={{ color: colors.muted }}>
                  &hellip; and {tracks.length - 10} more
                </li>
              )}
            </ul>
          )}
        </div>
      );
    }
    return null;
  }, [
    hoveredNode,
    hoveredLink,
    trackCollabFilterMap,
    graphDegreeMap,
    hideNonPrimary,
    collabCountBasis,
    colors,
  ]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) {
        if (e.key === "Escape") {
          (e.target as HTMLElement).blur();
        }
        return;
      }
      if (e.key === "Escape") {
        if (selectionCollabsModalOpen) {
          setSelectionCollabsModalOpen(false);
          return;
        }
        if (distroModalOpen) {
          closeDistroModal();
          return;
        }
        if (shortcutsOpen) {
          setShortcutsOpen(false);
          return;
        }
        if (searchOpen) {
          setSearchOpen(false);
          return;
        }
        if (rangeSelection.length > 0) {
          setRangeSelection([]);
          return;
        }
        if (selectedNodeId) {
          setSelectedNodeId(null);
          return;
        }
        return;
      }
      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        e.preventDefault();
        setShortcutsOpen((o) => !o);
        return;
      }
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        searchInputRef.current?.focus();
        setSearchOpen(true);
        return;
      }
      if (e.key === "f" || e.key === "F") {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        e.preventDefault();
        fgRef.current?.zoomToFit(600, 40);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    selectionCollabsModalOpen,
    distroModalOpen,
    shortcutsOpen,
    searchOpen,
    rangeSelection.length,
    selectedNodeId,
    closeDistroModal,
  ]);

  /* -------- Render -------- */

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      <Modal
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        title="Network shortcuts"
        subtitle="View and graph tools"
        maxWidthClassName="max-w-md"
      >
        <ul className="list-none space-y-2.5 text-sm" style={{ color: "var(--sb-text)" }}>
          <li>
            <kbd className="rounded border px-1.5 py-0.5 font-mono text-[11px]" style={{ borderColor: "var(--sb-border)" }}>/</kbd>{" "}
            <span style={{ color: "var(--sb-muted)" }}>Focus search</span>
          </li>
          <li>
            <kbd className="rounded border px-1.5 py-0.5 font-mono text-[11px]" style={{ borderColor: "var(--sb-border)" }}>?</kbd>{" "}
            <span style={{ color: "var(--sb-muted)" }}>Toggle this panel</span>
          </li>
          <li>
            <kbd className="rounded border px-1.5 py-0.5 font-mono text-[11px]" style={{ borderColor: "var(--sb-border)" }}>Esc</kbd>{" "}
            <span style={{ color: "var(--sb-muted)" }}>Close modals, then clear box selection, then clear artist focus</span>
          </li>
          <li>
            <kbd className="rounded border px-1.5 py-0.5 font-mono text-[11px]" style={{ borderColor: "var(--sb-border)" }}>F</kbd>{" "}
            <span style={{ color: "var(--sb-muted)" }}>Fit graph to view</span>
          </li>
          <li>
            <span style={{ color: "var(--sb-muted)" }}>
              A faint grid moves with the graph (not the window). When you zoom in, finer dashed lines can appear; x=0 and y=0
              are drawn slightly bolder when visible.
            </span>
          </li>
          <li>
            <span style={{ color: "var(--sb-muted)" }}>
              The download button exports the current view (playlist, hide-non-primary, collab filter) to a multi-sheet{" "}
              <code className="font-mono text-[11px]">.xlsx</code> (Summary, Artists, Collaborations, Tracks, Tracks unique) in
              your browser.
            </span>
          </li>
          <li className="pt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
            URL keeps playlist, filters, toggles, <code className="font-mono">collab_max</code> /{" "}
            <code className="font-mono">collab_min</code>, <code className="font-mono">co_basis=primary</code> (lead rows
            only; default is playlist-wide), and selection (up to {MAX_SEL_URL} artists). Pan/zoom is
            restored per graph scope in this browser.
          </li>
          <li className="text-xs" style={{ color: "var(--sb-muted)" }}>
            Touch / pen: hold still ~{(NETWORK_LONG_PRESS_MS / 1000).toFixed(2)}s (same idea as the home scatter chart), then
            drag a box. Dragging
            without holding pans the graph. Optional: <span style={{ color: "var(--sb-text)", fontWeight: 600 }}>Select region</span>{" "}
            starts a marquee immediately.
          </li>
        </ul>
      </Modal>

      {/* Controls bar */}
      <div
        className="flex items-center gap-3 px-4 py-2.5 flex-wrap border-b"
        style={{
          borderColor: colors.border,
          backgroundColor: colors.card,
        }}
      >
        {/* Playlist scope */}
        <MenuSelect
          value={playlistKey ?? ""}
          options={playlistScopeOptions}
          onChange={(v) => {
            pushNetworkUrl({ playlistKey: v || null });
          }}
          ariaLabel="Scope graph to playlist"
          placeholder="All catalog tracks"
          matchTriggerWidth={false}
          className="min-w-[10rem] max-w-[min(100vw-8rem,17rem)]"
          menuClassName="max-h-80 min-w-[min(100vw-2rem,17rem)] overflow-y-auto"
        />

        <div
          className="flex flex-wrap items-center gap-1.5 rounded-lg px-2 py-1 text-[11px]"
          style={{
            backgroundColor: colors.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
            color: colors.text,
          }}
        >
          <span className="shrink-0 pl-0.5" style={{ color: colors.muted }}>
            Co-artists
          </span>
          <div className="flex rounded-md overflow-hidden border shrink-0" style={{ borderColor: colors.border }}>
            <button
              type="button"
              className="px-2 py-1 font-medium transition-colors"
              style={{
                backgroundColor:
                  collabFilterMode === "le"
                    ? colors.isDark
                      ? "rgba(212,255,77,0.14)"
                      : "rgba(168,214,46,0.2)"
                    : "transparent",
                color: collabFilterMode === "le" ? colors.text : colors.muted,
              }}
              onClick={() => {
                if (collabFilterMode === "le") return;
                setCollabFilterMode("le");
                pushNetworkUrl({ collabFilterMode: "le" });
              }}
            >
              Up to
            </button>
            <button
              type="button"
              className="px-2 py-1 font-medium transition-colors border-l"
              style={{
                borderColor: colors.border,
                backgroundColor:
                  collabFilterMode === "ge"
                    ? colors.isDark
                      ? "rgba(212,255,77,0.14)"
                      : "rgba(168,214,46,0.2)"
                    : "transparent",
                color: collabFilterMode === "ge" ? colors.text : colors.muted,
              }}
              onClick={() => {
                if (collabFilterMode === "ge") return;
                setCollabFilterMode("ge");
                pushNetworkUrl({ collabFilterMode: "ge" });
              }}
            >
              At least
            </button>
          </div>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="Any"
            title="Leave blank for all artists. Use Playlist vs Lead only (next to count) to choose what we count. Enter 0–999, then blur or Enter."
            aria-label="Filter by co-artist count on tracks"
            className="w-11 min-w-0 rounded px-1.5 py-1 font-mono text-xs tabular-nums outline-none border"
            style={{
              borderColor: colors.border,
              backgroundColor: colors.isDark ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.7)",
              color: colors.text,
            }}
            value={collabInputDraft}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "" || /^\d*$/.test(v)) setCollabInputDraft(v);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              }
            }}
            onBlur={() => {
              const parsed = parseCollabInputDraft(collabInputDraft);
              setCollabFilterN(parsed);
              setCollabInputDraft(parsed == null ? "" : String(parsed));
              pushNetworkUrl({ collabFilterN: parsed });
            }}
          />
          <span className="shrink-0" style={{ color: colors.muted }}>
            count:
          </span>
          <div className="flex rounded-md overflow-hidden border shrink-0" style={{ borderColor: colors.border }}>
            <button
              type="button"
              className="px-2 py-1 font-medium transition-colors"
              title="Count anyone else credited on the same scoped track (use for “no collabs in this playlist”)."
              style={{
                backgroundColor:
                  collabCountBasis === "playlist"
                    ? colors.isDark
                      ? "rgba(212,255,77,0.14)"
                      : "rgba(168,214,46,0.2)"
                    : "transparent",
                color: collabCountBasis === "playlist" ? colors.text : colors.muted,
              }}
              onClick={() => {
                if (collabCountBasis === "playlist") return;
                setCollabCountBasis("playlist");
                pushNetworkUrl({ collabCountBasis: "playlist" });
              }}
            >
              Playlist
            </button>
            <button
              type="button"
              className="px-2 py-1 font-medium transition-colors border-l"
              title="Count only co-artists on tracks where this artist is the lead (first credit). Ignores features-only collabs."
              style={{
                borderColor: colors.border,
                backgroundColor:
                  collabCountBasis === "primary_rows"
                    ? colors.isDark
                      ? "rgba(212,255,77,0.14)"
                      : "rgba(168,214,46,0.2)"
                    : "transparent",
                color: collabCountBasis === "primary_rows" ? colors.text : colors.muted,
              }}
              onClick={() => {
                if (collabCountBasis === "primary_rows") return;
                setCollabCountBasis("primary_rows");
                pushNetworkUrl({ collabCountBasis: "primary_rows" });
              }}
            >
              Lead only
            </button>
          </div>
        </div>

        <div className="w-px h-5" style={{ backgroundColor: colors.border }} />

        {/* Search */}
        <div className="relative">
          <div
            className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm"
            style={{
              backgroundColor: colors.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
              color: colors.text,
            }}
          >
            <Search size={14} style={{ color: colors.muted }} />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search artist…"
              className="bg-transparent outline-none w-44 placeholder:opacity-40"
              style={{ color: colors.text }}
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => {
                // Delay so click on result fires first
                setTimeout(() => setSearchOpen(false), 200);
              }}
            />
          </div>

          {/* Search dropdown */}
          {searchOpen && searchResults.length > 0 && (
            <div
              className="absolute top-full left-0 mt-1 rounded-lg shadow-lg z-50 overflow-hidden max-h-[300px] overflow-y-auto w-64"
              style={{
                backgroundColor: colors.card,
                border: `1px solid ${colors.border}`,
              }}
            >
              {searchResults.map((r) => (
                <button
                  key={r.id}
                  className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:brightness-125 transition-all"
                  style={{ color: colors.text }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    focusOnArtist(r.id);
                  }}
                >
                  {r.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={r.image_url}
                      alt=""
                      className="w-6 h-6 rounded-full object-cover flex-shrink-0"
                    />
                  ) : (
                    <div
                      className="w-6 h-6 rounded-full flex-shrink-0"
                      style={{ backgroundColor: colors.accent + "30" }}
                    />
                  )}
                  <span className="truncate">{r.name}</span>
                  <span className="ml-auto text-xs flex-shrink-0" style={{ color: colors.muted }}>
                    {r.track_count} tracks
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="w-px h-5" style={{ backgroundColor: colors.border }} />

        <ToggleButton
          active={scaleByTracks}
          onClick={() => pushNetworkUrl({ scaleByTracks: !scaleByTracks })}
          icon={<Scaling size={14} />}
          title="Scale by tracks — node size reflects catalog track count for each artist"
          colors={colors}
        />

        <ToggleButton
          active={showImages}
          onClick={() => pushNetworkUrl({ showImages: !showImages })}
          icon={<ImageIcon size={14} />}
          title="Show images — artist avatars on the graph (when available)"
          colors={colors}
        />

        <ToggleButton
          active={boxSelectArmed}
          onClick={() => setBoxSelectArmed((v) => !v)}
          icon={<SquareDashed size={14} />}
          title="Select region — tap or click to start a box selection (touch: long-press ~0.5s then drag, or use this)"
          colors={colors}
        />

        <ToggleButton
          active={hideNonPrimary}
          onClick={() => pushNetworkUrl({ hideNonPrimary: !hideNonPrimary })}
          icon={<UserRound size={14} />}
          title="Hide non-primary — only artists who are primary on at least one track in scope"
          colors={colors}
        />

        {/* Divider */}
        <div className="w-px h-5" style={{ backgroundColor: colors.border }} />

        {xlsxExportPhase ? (
          <span
            className="text-[11px] tabular-nums truncate max-w-[7rem] sm:max-w-[14rem]"
            style={{ color: colors.muted }}
          >
            {xlsxExportPhase}
          </span>
        ) : null}

        <IconButton
          type="button"
          variant="ghost"
          size="sm"
          title="Download Excel — current view (Summary, Artists, Collaborations, Tracks, Tracks unique)"
          aria-label="Download Excel export of current network view"
          disabled={xlsxExporting}
          onClick={() => void handleExportViewXlsx()}
          className="!h-8 !w-8 shrink-0 !rounded-lg"
          style={{
            color: colors.muted,
            backgroundColor: colors.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
          }}
        >
          {xlsxExporting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Download className="h-3.5 w-3.5" aria-hidden />
          )}
        </IconButton>

        <IconButton
          type="button"
          variant="ghost"
          size="sm"
          title="Keyboard shortcuts (?)"
          aria-label="Keyboard shortcuts"
          onClick={() => setShortcutsOpen(true)}
          className="!h-8 !w-8 shrink-0 !rounded-lg"
          style={{
            color: colors.muted,
            backgroundColor: colors.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
          }}
        >
          <Keyboard className="h-3.5 w-3.5" aria-hidden />
        </IconButton>

        <IconButton
          type="button"
          variant="ghost"
          size="sm"
          title="Reset — clear selection, collab filter, search; clear saved camera; fit graph"
          aria-label="Reset network view"
          onClick={handleReset}
          className="!h-8 !w-8 shrink-0 !rounded-lg"
          style={{
            color: colors.muted,
            backgroundColor: colors.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
          }}
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
        </IconButton>

        {/* Stats */}
        <div className="ml-auto text-xs text-right" style={{ color: colors.muted }}>
          {playlistKey ? (
            <span className="block sm:inline">
              Scoped:{" "}
              {playlists.find((p) => p.playlist_key === playlistKey)?.display_name ??
                playlistKey}
              {" · "}
            </span>
          ) : null}
          {collabFilterN != null ? (
            <>
              <span className="whitespace-nowrap">
                {graphData.nodes.length} visible ({collabFilterMode === "le" ? "≤" : "≥"}
                {collabFilterN} on-track) &middot; {graphData.links.length} links
              </span>
              <span className="opacity-70"> — full </span>
            </>
          ) : null}
          {nodes.length} artists &middot; {edges.length} collaborations
          <span className="mt-0.5 block text-[10px] opacity-80 xl:hidden">
            Hold ~0.5s then drag to box-select · drag to pan
          </span>
          <span className="hidden xl:inline">
            {" "}
            &middot; Alt+drag or Select region (touch: hold ~0.5s, then drag) &middot; Ctrl+click distro &middot; ? shortcuts
          </span>
        </div>
      </div>

      {xlsxExportAlert ? (
        <div
          className="flex items-start gap-2 px-4 py-2 border-b text-sm"
          style={{
            borderColor: colors.border,
            backgroundColor: colors.isDark ? "rgba(245,158,11,0.12)" : "rgba(245,158,11,0.15)",
            color: colors.text,
          }}
        >
          <span className="flex-1 min-w-0">{xlsxExportAlert}</span>
          <button
            type="button"
            className="shrink-0 rounded-md p-1 hover:opacity-80"
            style={{ color: colors.muted }}
            aria-label="Dismiss export notice"
            onClick={() => setXlsxExportAlert(null)}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ) : null}

      <ArtistDistroTracksModal
        open={distroModalOpen}
        onClose={closeDistroModal}
        artistName={distroArtistName}
        distroPlaylists={distroPlaylists}
        tracks={distroTracks}
        artistIdToName={distroNameMap}
        loading={distroLoading}
        error={distroError}
      />

      <SelectionCollabsModal
        open={selectionCollabsModalOpen}
        onClose={() => setSelectionCollabsModalOpen(false)}
        internalEdges={rangeStats.internalEdges}
        nodes={nodes}
        scopeLabel={
          playlistKey
            ? playlists.find((p) => p.playlist_key === playlistKey)?.display_name ?? playlistKey
            : "All catalog"
        }
        onNetworkSelectArtist={(artistId) => {
          setSelectedNodeId(null);
          setRangeSelection([artistId]);
          setSelectionCollabsModalOpen(false);
        }}
      />

      {/* Selected artist info panel */}
      {selectedNodeId && (
        <SelectedArtistPanel
          nodeId={selectedNodeId}
          nodes={graphData.nodes}
          edges={edges}
          neighbors={neighborsView}
          coArtistsOnTracks={(() => {
            const nn = nodes.find((n) => n.id === selectedNodeId);
            return nn ? trackScopedCoartistCount(nn, collabCountBasis) : 0;
          })()}
          graphNeighborCount={graphDegreeMap.get(selectedNodeId) ?? 0}
          collabCountBasis={collabCountBasis}
          hideNonPrimary={hideNonPrimary}
          colors={colors}
          onClose={() => setSelectedNodeId(null)}
          onFocusArtist={focusOnArtist}
        />
      )}

      {rangeSelection.length > 0 && (
        <SelectionStatsPanel
          artistCount={rangeSelection.length}
          playlistScopeLabel={
            playlistKey
              ? playlists.find((p) => p.playlist_key === playlistKey)?.display_name ??
                playlistKey
              : "All catalog"
          }
          internalEdgeCount={rangeStats.internalEdges.length}
          weightSum={rangeStats.weightSum}
          uniqueCollabTracks={rangeStats.unionIsrcs.length}
          streamTotals={streamTotals}
          colors={colors}
          onOpenCollabsList={() => setSelectionCollabsModalOpen(true)}
          onClear={() => {
            setSelectionCollabsModalOpen(false);
            setRangeSelection([]);
          }}
        />
      )}

      {/* Graph container */}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden touch-none"
        onPointerDownCapture={onBoxPointerDownCapture}
        onPointerMoveCapture={onBoxPointerMoveCapture}
        onPointerUpCapture={onBoxPointerUpCapture}
        onPointerCancelCapture={onBoxPointerCancelCapture}
      >
        {boxRect && boxRect.width + boxRect.height > 0 ? (
          <div
            className="absolute z-[15] pointer-events-none rounded-sm border-2 border-dashed"
            style={{
              left: boxRect.left,
              top: boxRect.top,
              width: boxRect.width,
              height: boxRect.height,
              borderColor: colors.accent,
              backgroundColor: colors.isDark ? "rgba(212,255,77,0.06)" : "rgba(168,214,46,0.08)",
            }}
          />
        ) : null}
        <ForceGraph2D
          ref={fgRef}
          graphData={graphData}
          width={dimensions.width}
          height={dimensions.height}
          backgroundColor="transparent"
          autoPauseRedraw={tabHidden || xlsxExporting}
          onRenderFramePre={onRenderFramePre}
          onZoomEnd={() => scheduleCameraSave()}
          // Node
          nodeId="id"
          nodeVal={nodeVal}
          nodeCanvasObject={nodeCanvasObject}
          nodeCanvasObjectMode={() => "replace" as const}
          nodePointerAreaPaint={nodePointerAreaPaint}
          // Link
          linkSource="source"
          linkTarget="target"
          linkWidth={linkWidth}
          linkColor={linkColor}
          linkCurvature={0.15}
          // Interaction
          onNodeClick={handleNodeClick}
          onNodeHover={handleNodeHover}
          onLinkHover={handleLinkHover}
          onBackgroundClick={handleBackgroundClick}
          linkHoverPrecision={6}
          enableNodeDrag={true}
          // Engine
          d3AlphaDecay={0.02}
          d3VelocityDecay={0.3}
          warmupTicks={80}
          cooldownTime={3000}
          onEngineStop={onEngineStop}
          minZoom={0.3}
          maxZoom={20}
        />

        {/* Tooltip overlay */}
        {tooltipContent && tooltipPos && (
          <div
            className="absolute pointer-events-none z-50 rounded-lg px-3 py-2 shadow-lg max-w-[280px]"
            style={{
              left: tooltipPos.x + 14,
              top: tooltipPos.y + 14,
              backgroundColor: colors.card,
              border: `1px solid ${colors.border}`,
              backdropFilter: "blur(12px)",
            }}
          >
            {tooltipContent}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Box selection stats                                                */
/* ------------------------------------------------------------------ */

function SelectionStatsPanel({
  artistCount,
  playlistScopeLabel,
  internalEdgeCount,
  weightSum,
  uniqueCollabTracks,
  streamTotals,
  colors,
  onOpenCollabsList,
  onClear,
}: {
  artistCount: number;
  playlistScopeLabel: string;
  internalEdgeCount: number;
  weightSum: number;
  uniqueCollabTracks: number;
  streamTotals: { total: number | null; daily: number | null; loading: boolean };
  colors: ReturnType<typeof useThemeColors>;
  onOpenCollabsList: () => void;
  onClear: () => void;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 border-b text-xs"
      style={{
        borderColor: colors.border,
        backgroundColor: colors.isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
        color: colors.text,
      }}
    >
      <div className="font-semibold" style={{ color: colors.accent }}>
        {artistCount} artist{artistCount !== 1 ? "s" : ""} selected
      </div>
      <div style={{ color: colors.muted }}>
        Scope: <span style={{ color: colors.text }}>{playlistScopeLabel}</span>
      </div>
      {artistCount >= 2 ? (
        <>
          <div style={{ color: colors.muted }}>
            Collab links:{" "}
            <span className="font-mono font-medium" style={{ color: colors.text }}>
              {internalEdgeCount}
            </span>
          </div>
          <div style={{ color: colors.muted }}>
            Shared track credits:{" "}
            <span className="font-mono font-medium" style={{ color: colors.text }}>
              {weightSum}
            </span>
          </div>
          <div style={{ color: colors.muted }}>
            Unique collab tracks:{" "}
            <span className="font-mono font-medium" style={{ color: colors.text }}>
              {uniqueCollabTracks}
            </span>
          </div>
          {uniqueCollabTracks > 0 ? (
            <div style={{ color: colors.muted }}>
              Streams (those tracks):{" "}
              <span className="font-mono font-medium" style={{ color: "var(--sb-positive)" }}>
                {streamTotals.loading
                  ? "…"
                  : streamTotals.total != null
                    ? formatInt(streamTotals.total)
                    : "—"}
              </span>
              <span className="mx-1 opacity-50">·</span>
              Daily:{" "}
              <span className="font-mono font-medium" style={{ color: "var(--sb-positive)" }}>
                {streamTotals.loading
                  ? "…"
                  : streamTotals.daily != null
                    ? formatInt(streamTotals.daily)
                    : "—"}
              </span>
            </div>
          ) : null}
        </>
      ) : (
        <div style={{ color: colors.muted }}>Alt+drag a box to select 2+ artists for collab stats.</div>
      )}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {artistCount >= 2 && internalEdgeCount > 0 ? (
          <button
            type="button"
            className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors"
            style={{
              color: colors.accent,
              backgroundColor: colors.isDark ? "rgba(212,255,77,0.12)" : "rgba(168,214,46,0.15)",
            }}
            onClick={onOpenCollabsList}
          >
            <ListMusic className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Tracks & collabs
          </button>
        ) : null}
        <button
          type="button"
          className="rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors"
          style={{
            color: colors.muted,
            backgroundColor: colors.isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
          }}
          onClick={onClear}
        >
          Clear selection
        </button>
      </div>
    </div>
  );
}

type IsrcDetailPayload = {
  isrc: string;
  name: string | null;
  spotify_album_image_url: string | null;
  spotify_track_id?: string | null;
  release_date: string | null;
  totalStreams: number | null;
  dailyStreams: number | null;
  artistsOnTrack?: string;
  distroPlaylists?: string;
};

function SelectionArtistAvatar({ url }: { url: string | null }) {
  return url ? (
    <NextImage
      src={url}
      alt=""
      width={28}
      height={28}
      className="h-7 w-7 shrink-0 rounded-full object-cover sb-ring"
    />
  ) : (
    <div
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full sb-ring"
      style={{ background: "var(--sb-row-hover)" }}
    >
      <UserRound className="h-3.5 w-3.5 opacity-40" aria-hidden />
    </div>
  );
}

/** Catalog artist link; Ctrl/Cmd+click selects that node on the network graph (same modifier as the canvas). */
function NetworkCatalogArtistLink({
  artistId,
  onNetworkSelectArtist,
  className,
  children,
}: {
  artistId: string;
  onNetworkSelectArtist?: (id: string) => void;
  className?: string;
  children: React.ReactNode;
}) {
  const href = `/catalog?artist_id=${encodeURIComponent(artistId)}`;
  return (
    <Link
      href={href}
      className={className}
      onClick={(e) => {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          onNetworkSelectArtist?.(artistId);
        }
      }}
    >
      {children}
    </Link>
  );
}

function SelectionCollabsModal({
  open,
  onClose,
  internalEdges,
  nodes,
  scopeLabel,
  onNetworkSelectArtist,
}: {
  open: boolean;
  onClose: () => void;
  internalEdges: GraphEdge[];
  nodes: GraphNode[];
  scopeLabel: string;
  onNetworkSelectArtist?: (artistId: string) => void;
}) {
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const nameById = useMemo(() => new Map(nodes.map((n) => [n.id, n.name])), [nodes]);

  const rows = useMemo(() => {
    const out: Array<{
      key: string;
      artistIdFirst: string;
      artistIdSecond: string;
      artistNameFirst: string;
      artistNameSecond: string;
      pairLabel: string;
      trackName: string;
      isrc: string;
    }> = [];
    for (const e of internalEdges) {
      const nameSource = nameById.get(e.source) ?? e.source;
      const nameTarget = nameById.get(e.target) ?? e.target;
      let artistIdFirst = e.source;
      let artistIdSecond = e.target;
      let labelFirst = nameSource;
      let labelSecond = nameTarget;
      if (nameSource.localeCompare(nameTarget) > 0) {
        artistIdFirst = e.target;
        artistIdSecond = e.source;
        labelFirst = nameTarget;
        labelSecond = nameSource;
      }
      const pairLabel = `${labelFirst} × ${labelSecond}`;
      for (const t of e.shared_tracks ?? []) {
        if (!t.isrc) continue;
        out.push({
          key: `${e.source}|${e.target}|${t.isrc}`,
          artistIdFirst,
          artistIdSecond,
          artistNameFirst: labelFirst,
          artistNameSecond: labelSecond,
          pairLabel,
          trackName: t.name ?? "—",
          isrc: t.isrc,
        });
      }
    }
    out.sort(
      (a, b) =>
        a.pairLabel.localeCompare(b.pairLabel) ||
        a.trackName.localeCompare(b.trackName) ||
        a.isrc.localeCompare(b.isrc),
    );
    return out;
  }, [internalEdges, nameById]);

  const [detailByIsrc, setDetailByIsrc] = useState<Map<string, IsrcDetailPayload>>(() => new Map());
  const [detailsLoading, setDetailsLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      setDetailByIsrc(new Map());
      setDetailsLoading(false);
      return;
    }
    const isrcs = [...new Set(rows.map((r) => r.isrc))];
    if (isrcs.length === 0) {
      setDetailByIsrc(new Map());
      setDetailsLoading(false);
      return;
    }
    let cancelled = false;
    setDetailsLoading(true);
    fetch("/api/admin/isrc-batch-details", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isrcs }),
    })
      .then((res) => res.json())
      .then((j: { tracks?: IsrcDetailPayload[]; error?: string }) => {
        if (cancelled) return;
        const m = new Map<string, IsrcDetailPayload>();
        for (const t of j.tracks ?? []) {
          m.set(t.isrc, t);
        }
        setDetailByIsrc(m);
      })
      .catch(() => {
        if (!cancelled) setDetailByIsrc(new Map());
      })
      .finally(() => {
        if (!cancelled) setDetailsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, rows]);

  const csvRows = useMemo(() => {
    return rows.map((r) => {
      const d = detailByIsrc.get(r.isrc);
      return {
        collaboration: r.pairLabel,
        track: d?.name ?? r.trackName,
        isrc: r.isrc,
        release_date: d?.release_date ? formatDateISO(d.release_date) : "",
        total_streams: d?.totalStreams ?? "",
        daily_streams: d?.dailyStreams ?? "",
      };
    });
  }, [rows, detailByIsrc]);

  const linkWord = internalEdges.length === 1 ? "link" : "links";
  const creditWord = rows.length === 1 ? "credit" : "credits";
  const streamAccent = "var(--sb-positive)";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Selected collaborations"
      subtitle={`${scopeLabel} · ${internalEdges.length} collab ${linkWord} · ${rows.length} track ${creditWord}`}
      maxWidthClassName="max-w-5xl"
      headerActions={
        <ChartCsvDownloadButton
          rows={csvRows as unknown as Array<Record<string, unknown>>}
          filename={`network-collabs-${slugifyForFilename(scopeLabel)}-${todayIsoDate()}.csv`}
          title="Download CSV"
          sortForExport={false}
          headers={["collaboration", "track", "isrc", "release_date", "total_streams", "daily_streams"]}
          disabled={rows.length === 0}
        />
      }
    >
      <div className="mb-3">
        {detailsLoading ? (
          <span className="text-[11px] opacity-60" style={{ color: "var(--sb-muted)" }}>
            Loading track metadata…
          </span>
        ) : (
          <span className="text-[11px] opacity-60" style={{ color: "var(--sb-muted)" }}>
            Streams use the latest cumulative day in your data (same as catalog). Ctrl/⌘+click an artist
            (name or photo) to select only them on the graph; playlist / filters stay the same and this
            dialog closes.
          </span>
        )}
      </div>
      <GlassTable
        headers={[
          { label: "Collaboration", className: "w-[200px]" },
          { label: "Track", className: "min-w-0" },
          { label: "Total streams", align: "right" as const, className: "w-[100px]" },
          { label: "Daily streams", align: "right" as const, className: "w-[100px]" },
          { label: "ISRC", className: "w-[140px]" },
        ]}
        maxBodyHeightClassName="max-h-[60vh]"
        tableLayout="fixed"
      >
        {rows.length === 0 ? (
          <EmptyState
            colSpan={5}
            message="No shared track rows"
            description="Per-link tracks may be omitted for large graphs, or these edges have no ISRC payload yet."
          />
        ) : (
          rows.map((r) => {
            const d = detailByIsrc.get(r.isrc);
            const n1 = nodeById.get(r.artistIdFirst);
            const n2 = nodeById.get(r.artistIdSecond);
            const displayName = d?.name ?? r.trackName;
            const albumUrl = d?.spotify_album_image_url ?? null;
            const releaseRaw = d?.release_date ?? null;
            const total = d?.totalStreams ?? null;
            const daily = d?.dailyStreams ?? null;

            return (
              <TableRow key={r.key}>
                <TableCell className="align-top">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="flex shrink-0 -space-x-1.5">
                      <NetworkCatalogArtistLink
                        artistId={r.artistIdFirst}
                        onNetworkSelectArtist={onNetworkSelectArtist}
                        className="shrink-0 rounded-full sb-ring transition-opacity hover:opacity-90"
                      >
                        <SelectionArtistAvatar url={n1?.image_url ?? null} />
                      </NetworkCatalogArtistLink>
                      <NetworkCatalogArtistLink
                        artistId={r.artistIdSecond}
                        onNetworkSelectArtist={onNetworkSelectArtist}
                        className="shrink-0 rounded-full sb-ring transition-opacity hover:opacity-90"
                      >
                        <SelectionArtistAvatar url={n2?.image_url ?? null} />
                      </NetworkCatalogArtistLink>
                    </div>
                    <div
                      className="min-w-0 text-xs font-medium leading-snug"
                      style={{ color: "var(--sb-text)" }}
                      title={r.pairLabel}
                    >
                      <NetworkCatalogArtistLink
                        artistId={r.artistIdFirst}
                        onNetworkSelectArtist={onNetworkSelectArtist}
                        className="sb-link-hover"
                      >
                        {r.artistNameFirst}
                      </NetworkCatalogArtistLink>
                      <span className="mx-0.5 opacity-50" aria-hidden>
                        ×
                      </span>
                      <NetworkCatalogArtistLink
                        artistId={r.artistIdSecond}
                        onNetworkSelectArtist={onNetworkSelectArtist}
                        className="sb-link-hover"
                      >
                        {r.artistNameSecond}
                      </NetworkCatalogArtistLink>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="align-top">
                  <div className="flex min-w-0 items-center gap-2">
                    {albumUrl ? (
                      <NextImage
                        src={albumUrl}
                        alt=""
                        width={32}
                        height={32}
                        className="h-8 w-8 shrink-0 rounded-lg object-cover sb-ring"
                      />
                    ) : (
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg sb-ring bg-white/60 dark:bg-white/10">
                        <Disc3 className="h-4 w-4 opacity-40" aria-hidden />
                      </div>
                    )}
                    <div className="min-w-0">
                      <Link
                        href={`/catalog?artist_id=${encodeURIComponent(r.artistIdFirst)}&isrc=${encodeURIComponent(r.isrc)}`}
                        className="sb-link-hover block truncate text-sm font-medium"
                      >
                        {displayName}
                      </Link>
                    </div>
                  </div>
                </TableCell>
                <TableCell numeric className="align-top text-xs font-medium" style={{ color: streamAccent }}>
                  {detailsLoading ? "…" : total != null ? formatInt(total) : "—"}
                </TableCell>
                <TableCell
                  numeric
                  className="align-top text-xs font-medium opacity-80"
                  style={{ color: streamAccent }}
                >
                  {detailsLoading ? "…" : daily != null ? formatInt(daily) : "—"}
                </TableCell>
                <TableCell className="align-top" mono>
                  <div className="min-w-0 space-y-0.5">
                    <div className="font-mono text-[11px] opacity-70" style={{ color: "var(--sb-muted)" }}>
                      {r.isrc}
                    </div>
                    <div className="text-[10px] opacity-55" style={{ color: "var(--sb-muted)" }}>
                      {releaseRaw ? formatDateISO(releaseRaw) : "—"}
                    </div>
                  </div>
                </TableCell>
              </TableRow>
            );
          })
        )}
      </GlassTable>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/*  Toggle Button                                                      */
/* ------------------------------------------------------------------ */

function ToggleButton({
  active,
  onClick,
  icon,
  title,
  colors,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  colors: ReturnType<typeof useThemeColors>;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs transition-colors"
      style={{
        color: active ? colors.accent : colors.muted,
        backgroundColor: active
          ? colors.isDark
            ? "rgba(212,255,77,0.12)"
            : "rgba(168,214,46,0.15)"
          : colors.isDark
            ? "rgba(255,255,255,0.06)"
            : "rgba(0,0,0,0.04)",
      }}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Selected Artist Panel                                              */
/* ------------------------------------------------------------------ */

function SelectedArtistPanel({
  nodeId,
  nodes,
  edges,
  neighbors,
  coArtistsOnTracks,
  graphNeighborCount,
  collabCountBasis,
  hideNonPrimary,
  colors,
  onClose,
  onFocusArtist,
}: {
  nodeId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  neighbors: Map<string, Set<string>>;
  coArtistsOnTracks: number;
  graphNeighborCount: number;
  collabCountBasis: CollabCountBasis;
  hideNonPrimary: boolean;
  colors: ReturnType<typeof useThemeColors>;
  onClose: () => void;
  onFocusArtist: (id: string) => void;
}) {
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;

  const neighborIds = neighbors.get(nodeId) ?? new Set();
  const neighborNodes = nodes.filter((n) => neighborIds.has(n.id));
  neighborNodes.sort((a, b) => {
    // Sort by shared track count descending
    const aEdge = edges.find(
      (e) =>
        (e.source === nodeId && e.target === a.id) ||
        (e.target === nodeId && e.source === a.id),
    );
    const bEdge = edges.find(
      (e) =>
        (e.source === nodeId && e.target === b.id) ||
        (e.target === nodeId && e.source === b.id),
    );
    return (bEdge?.weight ?? 0) - (aEdge?.weight ?? 0);
  });

  const relatedEdges = edges.filter(
    (e) => e.source === nodeId || e.target === nodeId,
  );
  const totalSharedTracks = relatedEdges.reduce((sum, e) => sum + e.weight, 0);

  return (
    <div
      className="flex items-start gap-3 px-4 py-2.5 border-b overflow-x-auto"
      style={{
        borderColor: colors.border,
        backgroundColor: colors.isDark ? "rgba(212,255,77,0.04)" : "rgba(168,214,46,0.06)",
      }}
    >
      {/* Artist image */}
      {node.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={node.image_url}
          alt=""
          className="w-10 h-10 rounded-full object-cover flex-shrink-0 mt-0.5"
        />
      ) : (
        <div
          className="w-10 h-10 rounded-full flex-shrink-0 mt-0.5"
          style={{ backgroundColor: colors.accent + "30" }}
        />
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm truncate" style={{ color: colors.text }}>
            {node.name}
          </span>
          <span className="text-xs flex-shrink-0" style={{ color: colors.muted }}>
            {node.track_count} tracks &middot; {coArtistsOnTracks} co-artist{coArtistsOnTracks !== 1 ? "s" : ""}{" "}
            {collabCountBasis === "playlist" ? "(playlist-wide)" : "(lead rows)"} &middot; {graphNeighborCount} graph
            neighbor{graphNeighborCount !== 1 ? "s" : ""} &middot; {totalSharedTracks} shared tracks
          </span>
          <button
            className="ml-auto text-xs px-2 py-0.5 rounded flex-shrink-0"
            style={{ color: colors.muted }}
            onClick={onClose}
          >
            &times;
          </button>
        </div>

        {coArtistsOnTracks > 0 && neighborNodes.length === 0 && hideNonPrimary ? (
          <div className="text-xs mt-1.5 max-w-xl" style={{ color: colors.muted }}>
            Co-artists on your tracks are not shown below because the graph only links artists who are both primary on
            some track in this playlist.
          </div>
        ) : null}

        {/* Graph-linked collaborators (subset of co-artists when Hide non-primary) */}
        {neighborNodes.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {neighborNodes.slice(0, 20).map((nb) => {
              const edge = relatedEdges.find(
                (e) =>
                  (e.source === nodeId && e.target === nb.id) ||
                  (e.target === nodeId && e.source === nb.id),
              );
              return (
                <button
                  key={nb.id}
                  className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition-colors hover:brightness-125"
                  style={{
                    backgroundColor: colors.isDark
                      ? "rgba(255,255,255,0.08)"
                      : "rgba(0,0,0,0.06)",
                    color: colors.text,
                  }}
                  onClick={() => onFocusArtist(nb.id)}
                >
                  {nb.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={nb.image_url}
                      alt=""
                      className="w-4 h-4 rounded-full object-cover"
                    />
                  ) : null}
                  <span className="truncate max-w-[120px]">{nb.name}</span>
                  {edge && edge.weight > 1 && (
                    <span style={{ color: colors.accent }} className="font-mono text-[10px]">
                      {edge.weight}
                    </span>
                  )}
                </button>
              );
            })}
            {neighborNodes.length > 20 && (
              <span className="text-xs px-2 py-0.5" style={{ color: colors.muted }}>
                +{neighborNodes.length - 20} more
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
