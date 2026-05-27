"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { ForwardRefExoticComponent, RefAttributes } from "react";
import dynamic from "next/dynamic";
import { PreviewableArtwork } from "@/components/ui/PreviewableArtwork";
import type { ForceGraphMethods, ForceGraphProps } from "react-force-graph-2d";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Search,
  RotateCcw,
  ImageIcon,
  Scaling,
  UserRound,
  UserX,
  Table2,
  SquareDashed,
  HelpCircle,
  Download,
  Loader2,
  X,
  Filter,
  Music,
} from "lucide-react";
import { fetchApiJson } from "@/lib/api";
import { dispatchCompetitorLabelChange } from "@/lib/competitorAccentEvents";
import type { DatasetMode } from "@/lib/datasetMode";
import type { NetworkGraphMode } from "@/lib/network/loadNetworkPage";
import { formatInt } from "@/lib/format";
import { slugifyForFilename, todayIsoDate } from "@/lib/csv";
import {
  downloadNetworkViewXlsx,
  type NetworkArtistStreamExportRow,
  type NetworkTrackSheetEnrichment,
  type NetworkViewExportEdge,
} from "@/lib/networkViewXlsx";
import { ChartCsvDownloadButton } from "@/components/charts/ChartCsvDownloadButton";
import { ViewportAwareTooltip } from "@/components/charts/ViewportAwareTooltip";
import { useThemeColors } from "@/components/charts/useThemeColors";
import { IconButton } from "@/components/ui/Button";
import { MenuSelect, type MenuSelectOption } from "@/components/ui/MenuSelect";
import { Modal } from "@/components/ui/Modal";
import {
  ArtistDistroTracksModal,
  type ArtistDistroTrackRow,
  type DistroPlaylist,
} from "@/components/catalog/ArtistDistroTracksModal";
import type { FilterConfig } from "@/components/filters/filterTypes";
import {
  filterNetworkArtistsClientSide,
  hasActiveConditions,
  countActiveConditions,
  networkFilterUsesStreamFields,
  type NetworkArtistStreamStatsRow,
} from "@/components/filters/filterQuery";
import { NetworkAdvancedFilterModal } from "./NetworkAdvancedFilterModal";
import { NetworkCustomScopeModal } from "./NetworkCustomScopeModal";
import { FrozenEdgeTrackDetailModal } from "./FrozenEdgeTrackDetailModal";
import { SharedTracksListModal } from "./SharedTracksListModal";
import { NetworkArtistsTable } from "./NetworkArtistsTable";
import { NetworkLinkCollaborationTooltipContent } from "./NetworkLinkCollaborationTooltip";
import {
  SelectionCollabsModal,
  SelectionScopedTracksModal,
  SelectionStatsPanel,
} from "./NetworkSelectionPanels";
import { SelectedArtistPanel, ToggleButton } from "./NetworkSelectedArtistPanel";
import {
  CAMERA_SAVE_MS,
  LS_NETWORK_CAMERA,
  LS_NETWORK_SHOW_GRID,
  MAX_SEL_URL,
  readNetworkShowGridFromStorage,
  NETWORK_GRID_MAX_LINES_PER_AXIS,
  NETWORK_GRID_MINOR_MAX_LINES_PER_AXIS,
  NETWORK_GRID_MINOR_MAX_PX,
  NETWORK_GRID_MINOR_MIN_PX,
  NETWORK_GRID_TARGET_PX,
  NETWORK_LONG_PRESS_MS,
  NETWORK_LONG_PRESS_MOVE_PX,
  SPOTIBASE_PUBLIC_ORIGIN,
  SCOPE_CATALOG,
  SCOPE_CUSTOM,
} from "./networkGraphConstants";
import { getImage } from "./networkGraphImageCache";
import {
  accentRgba,
  buildAdjacency,
  collaborationLinkKey,
  isTypingTarget,
  linkEndpointId,
  nearGridMultiple,
  pickNiceGridStep,
  scaleLinear,
  trackScopedCoartistCount,
  type FGLinkObj,
  type FGNodeObj,
} from "./networkGraphPure";
import type { CollabCountBasis, NetworkTableSortKey } from "./networkGraphTypes";
import {
  buildNetworkQueryString,
  coartistCountInRange,
  collabRangeIsActive,
  formatCollabRangeSummary,
  parseCollabCountBasis,
  parseCollabInputDraft,
  parseCollabRangeBounds,
  parseNetworkTableSort,
  parseTrackCountBounds,
  parseTrackCountInputDraft,
  readNetworkToggles,
} from "./networkGraphUrl";
import {
  ALL_CATALOG_PLAYLIST_KEY,
  appendNetworkScopeToSearchParams,
  DEFAULT_NETWORK_SCOPE,
  formatNetworkScopeLabel,
  networkScopeIdentity,
  parseNetworkScope,
  type NetworkScopeState,
} from "./networkScope";
import type { GraphNode, GraphEdge, NetworkPlaylistOption, SharedTrack } from "./networkTypes";

// Force-graph uses Canvas/WebGL — must skip SSR.
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
}) as unknown as ForwardRefExoticComponent<
  ForceGraphProps<GraphNode, GraphEdge> &
    RefAttributes<ForceGraphMethods<GraphNode, GraphEdge>>
>;

type FGNode = GraphNode;
type FGLink = GraphEdge;

interface Props {
  nodes: GraphNode[];
  edges: GraphEdge[];
  playlists: NetworkPlaylistOption[];
  hideNonPrimary: boolean;
  mode?: NetworkGraphMode;
  datasetMode?: DatasetMode;
}

export function NetworkGraphClient({
  nodes,
  edges,
  playlists,
  hideNonPrimary,
  mode = "artists",
  datasetMode = "own",
}: Props) {
  const isCrossLabelMode = mode === "cross-label";
  const isCompetitorDataset = datasetMode === "competitor";
  const catalogScopeLabel = isCompetitorDataset ? "All playlists" : "All Catalog";
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const validPlaylistKeys = useMemo(() => new Set(playlists.map((p) => p.playlist_key)), [playlists]);
  /** Exclude synthetic `all_catalog` row — same as graph “All Catalog” scope (see `Combobox` isAllCatalog). */
  const scopePlaylists = useMemo(
    () => playlists.filter((p) => p.playlist_key !== ALL_CATALOG_PLAYLIST_KEY),
    [playlists],
  );
  const networkScope = useMemo(() => {
    const sp: Record<string, string | string[] | undefined> = {};
    searchParams.forEach((value, key) => {
      sp[key] = value;
    });
    return parseNetworkScope(sp, validPlaylistKeys);
  }, [searchParams, validPlaylistKeys]);
  const scopeRef = useRef(networkScope);
  scopeRef.current = networkScope;
  /** Single-playlist key when scope mode is playlist; null for catalog or custom (used by stream APIs that expect one key). */
  const playlistKey = networkScope.mode === "playlist" ? networkScope.playlistKey : null;
  const networkScopeIdentityStr = useMemo(() => networkScopeIdentity(networkScope), [networkScope]);
  const playlistNameByKey = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of playlists) m.set(p.playlist_key, p.display_name);
    return m;
  }, [playlists]);
  const colors = useThemeColors();
  const fgRef = useRef<ForceGraphMethods<FGNode, FGLink> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const cameraSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Controls (URL-synced toggles — see effects below)
  const [scaleByTracks, setScaleByTracks] = useState(() => readNetworkToggles(searchParams).scaleByTracks);
  const [showImages, setShowImages] = useState(() => readNetworkToggles(searchParams).showImages);
  const [tableView, setTableView] = useState(() => readNetworkToggles(searchParams).tableView);
  const [collabFilterMin, setCollabFilterMin] = useState<number | null>(() =>
    parseCollabRangeBounds(searchParams).min,
  );
  const [collabFilterMax, setCollabFilterMax] = useState<number | null>(() =>
    parseCollabRangeBounds(searchParams).max,
  );
  const [collabMinDraft, setCollabMinDraft] = useState(() => {
    const { min } = parseCollabRangeBounds(searchParams);
    return min == null ? "" : String(min);
  });
  const [collabMaxDraft, setCollabMaxDraft] = useState(() => {
    const { max } = parseCollabRangeBounds(searchParams);
    return max == null ? "" : String(max);
  });
  const [collabCountBasis, setCollabCountBasis] = useState<CollabCountBasis>(() =>
    parseCollabCountBasis(searchParams),
  );
  const [trackCountMin, setTrackCountMin] = useState<number | null>(() =>
    parseTrackCountBounds(searchParams).min,
  );
  const [trackCountMax, setTrackCountMax] = useState<number | null>(() =>
    parseTrackCountBounds(searchParams).max,
  );
  const [trackCountMinDraft, setTrackCountMinDraft] = useState(() => {
    const { min } = parseTrackCountBounds(searchParams);
    return min == null ? "" : String(min);
  });
  const [trackCountMaxDraft, setTrackCountMaxDraft] = useState(() => {
    const { max } = parseTrackCountBounds(searchParams);
    return max == null ? "" : String(max);
  });
  const [customScopeModalOpen, setCustomScopeModalOpen] = useState(false);
  const [networkAdvModalOpen, setNetworkAdvModalOpen] = useState(false);
  const [networkAdvFilterApplied, setNetworkAdvFilterApplied] = useState<FilterConfig | null>(null);
  const [networkAdvStreamStats, setNetworkAdvStreamStats] = useState<Map<
    string,
    NetworkArtistStreamStatsRow
  > | null>(null);
  const [networkAdvStreamStatsLoading, setNetworkAdvStreamStatsLoading] = useState(false);
  const [networkAdvStreamStatsError, setNetworkAdvStreamStatsError] = useState<string | null>(null);
  const [boxSelectArmed, setBoxSelectArmed] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [tabHidden, setTabHidden] = useState(false);
  const [xlsxExporting, setXlsxExporting] = useState(false);
  const [xlsxExportPhase, setXlsxExportPhase] = useState<string | null>(null);
  const [xlsxExportAlert, setXlsxExportAlert] = useState<string | null>(null);
  const [tableStreamStats, setTableStreamStats] = useState<Map<
    string,
    NetworkArtistStreamExportRow
  > | null>(null);
  const [tableStreamStatsLoading, setTableStreamStatsLoading] = useState(false);
  const [tableStreamStatsError, setTableStreamStatsError] = useState(false);

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
  /** Pinned collaboration edge tooltip (mouse click or touch long-press on a link). */
  const [pinnedLink, setPinnedLink] = useState<FGLinkObj | null>(null);
  const [pinnedTooltipPos, setPinnedTooltipPos] = useState<{ x: number; y: number } | null>(null);

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
  /** Touch/pen: long-press on a node opens distro modal (desktop: Ctrl/Cmd+click). */
  const nodeDistroLongPressTimerRef = useRef<number | null>(null);
  const nodeDistroLongPressStartRef = useRef<{ x: number; y: number } | null>(null);
  const nodeDistroLongPressTargetRef = useRef<{ id: string; name: string } | null>(null);
  const nodeDistroLongPressPointerIdRef = useRef<number | null>(null);
  const suppressNextNodeClickRef = useRef(false);

  const pinnedLinkRef = useRef<FGLinkObj | null>(null);
  const pinnedLinkKeyRef = useRef<string | null>(null);
  const skipNextLinkClickRef = useRef(false);
  const linkPinLongPressTimerRef = useRef<number | null>(null);
  const linkPinLongPressStartRef = useRef<{ x: number; y: number } | null>(null);
  const linkPinLongPressPointerIdRef = useRef<number | null>(null);
  const linkPinPendingKeyRef = useRef<string | null>(null);
  const lastPointerClientRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const lastContainerPointerTypeRef = useRef<string | null>(null);
  const lastPointerIdRef = useRef<number | null>(null);

  const clearNodeDistroLongPress = useCallback(() => {
    if (nodeDistroLongPressTimerRef.current != null) {
      window.clearTimeout(nodeDistroLongPressTimerRef.current);
      nodeDistroLongPressTimerRef.current = null;
    }
    nodeDistroLongPressStartRef.current = null;
    nodeDistroLongPressTargetRef.current = null;
    nodeDistroLongPressPointerIdRef.current = null;
  }, []);

  const clearNetworkLongPress = useCallback(() => {
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    clearNodeDistroLongPress();
  }, [clearNodeDistroLongPress]);

  useEffect(() => () => clearNetworkLongPress(), [clearNetworkLongPress]);

  const clearLinkPinLongPress = useCallback(() => {
    if (linkPinLongPressTimerRef.current != null) {
      window.clearTimeout(linkPinLongPressTimerRef.current);
      linkPinLongPressTimerRef.current = null;
    }
    linkPinLongPressStartRef.current = null;
    linkPinLongPressPointerIdRef.current = null;
    linkPinPendingKeyRef.current = null;
  }, []);

  const clearPinnedLink = useCallback(() => {
    setPinnedLink(null);
    setPinnedTooltipPos(null);
    pinnedLinkKeyRef.current = null;
  }, []);

  useEffect(() => {
    pinnedLinkRef.current = pinnedLink;
  }, [pinnedLink]);

  const [streamTotals, setStreamTotals] = useState<{
    total: number | null;
    daily: number | null;
    trackCount: number | null;
    loading: boolean;
  }>({ total: null, daily: null, trackCount: null, loading: false });

  const [selectionCollabsModalOpen, setSelectionCollabsModalOpen] = useState(false);
  const [selectionScopedTracksOpen, setSelectionScopedTracksOpen] = useState(false);

  // Container sizing
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  const [showBackgroundGrid, setShowBackgroundGrid] = useState(true);
  useEffect(() => {
    setShowBackgroundGrid(readNetworkShowGridFromStorage());
    const sync = () => setShowBackgroundGrid(readNetworkShowGridFromStorage());
    window.addEventListener("sb:network-grid-updated", sync);
    const onStorage = (e: StorageEvent) => {
      if (e.key === LS_NETWORK_SHOW_GRID || e.key === null) sync();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("sb:network-grid-updated", sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

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

  /**
   * d3-zoom uses [minZoom, maxZoom] as hard limits. 0.3 blocked pinch / zoom-to-fit on phones when the laid-out graph
   * is much larger than the viewport. Coarse pointers use a very low floor (0.012) so the map can shrink further.
   */
  const [graphMinZoom, setGraphMinZoom] = useState(0.3);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(pointer: coarse)");
    const sync = () => setGraphMinZoom(mq.matches ? 0.012 : 0.3);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const r = readNetworkToggles(searchParams);
    setScaleByTracks(r.scaleByTracks);
    setShowImages(r.showImages);
    setTableView(r.tableView);
    const cf = parseCollabRangeBounds(searchParams);
    setCollabFilterMin(cf.min);
    setCollabFilterMax(cf.max);
    setCollabMinDraft(cf.min == null ? "" : String(cf.min));
    setCollabMaxDraft(cf.max == null ? "" : String(cf.max));
    setCollabCountBasis(parseCollabCountBasis(searchParams));
    const tc = parseTrackCountBounds(searchParams);
    setTrackCountMin(tc.min);
    setTrackCountMax(tc.max);
    setTrackCountMinDraft(tc.min == null ? "" : String(tc.min));
    setTrackCountMaxDraft(tc.max == null ? "" : String(tc.max));
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
    /* Match dashboard `Combobox` `isAllCatalog` tile (accent + Music). */
    const catalogThumb = (
      <div
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg"
        style={{ backgroundColor: "var(--sb-accent)" }}
        aria-hidden
      >
        <Music className="h-3.5 w-3.5" strokeWidth={2} style={{ color: "black" }} />
      </div>
    );
    const customThumb = (
      <div
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-[10px] font-semibold"
        style={{ backgroundColor: "var(--sb-surface)", color: "var(--sb-accent)" }}
        aria-hidden
      >
        +
      </div>
    );
    const customLabel =
      networkScope.mode === "custom"
        ? formatNetworkScopeLabel(networkScope, playlistNameByKey)
        : "Custom playlist scope…";
    return [
      { value: SCOPE_CATALOG, label: catalogScopeLabel, leading: catalogThumb },
      { value: SCOPE_CUSTOM, label: customLabel, leading: customThumb },
      ...scopePlaylists.map((p) => ({
        value: p.playlist_key,
        label: p.display_name,
        leading: p.spotify_playlist_image_url ? (
          <PreviewableArtwork
            src={p.spotify_playlist_image_url}
            alt={p.display_name}
            width={24}
            height={24}
            interactive="inline"
            className="h-6 w-6 shrink-0 rounded-lg object-cover"
          />
        ) : (
          <div
            className="h-6 w-6 shrink-0 rounded-lg"
            style={{ backgroundColor: "var(--sb-surface)" }}
            aria-hidden
          />
        ),
      })),
    ];
  }, [scopePlaylists, networkScope, playlistNameByKey, catalogScopeLabel]);

  const scopeMenuValue = useMemo(() => {
    if (networkScope.mode === "catalog") return SCOPE_CATALOG;
    if (networkScope.mode === "custom") return SCOPE_CUSTOM;
    return networkScope.playlistKey ?? SCOPE_CATALOG;
  }, [networkScope]);

  const networkExportScopeLabel = useMemo(
    () => formatNetworkScopeLabel(networkScope, playlistNameByKey),
    [networkScope, playlistNameByKey],
  );

  const tableSort = useMemo(() => parseNetworkTableSort(searchParams), [searchParams]);

  const collabCountBasisLabel = useMemo(
    () =>
      collabCountBasis === "playlist"
        ? "Playlist credits (any appearance on scoped tracks)"
        : "Primary tracks only (other artists on tracks where this artist is lead)",
    [collabCountBasis],
  );

  const collabFilterExportLabel = useMemo(() => {
    if (!collabRangeIsActive(collabFilterMin, collabFilterMax)) return "None";
    const range = formatCollabRangeSummary(collabFilterMin, collabFilterMax);
    return `Co-artists ${range}; ${collabCountBasis === "playlist" ? "playlist-wide" : "primary rows"}`;
  }, [collabFilterMin, collabFilterMax, collabCountBasis]);

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

  const collabVisibleNodeIds = useMemo(() => {
    if (!collabRangeIsActive(collabFilterMin, collabFilterMax)) return null;
    const s = new Set<string>();
    for (const node of nodes) {
      const cnt = trackCollabFilterMap.get(node.id) ?? 0;
      if (coartistCountInRange(cnt, collabFilterMin, collabFilterMax)) s.add(node.id);
    }
    return s;
  }, [nodes, trackCollabFilterMap, collabFilterMin, collabFilterMax]);

  const { trackCountMinEffective, trackCountMaxEffective } = useMemo(() => {
    const a = trackCountMin;
    const b = trackCountMax;
    if (a != null && b != null && a > b) {
      return { trackCountMinEffective: b, trackCountMaxEffective: a };
    }
    return { trackCountMinEffective: a, trackCountMaxEffective: b };
  }, [trackCountMin, trackCountMax]);

  /** Co-artist filter ∩ in-scope track-count bounds (graph node `track_count`). */
  const filteredVisibleNodeIds = useMemo(() => {
    const hasCollab = collabVisibleNodeIds !== null;
    const hasTc = trackCountMinEffective != null || trackCountMaxEffective != null;
    if (!hasCollab && !hasTc) return null;

    const out = new Set<string>();
    for (const node of nodes) {
      if (hasCollab && !collabVisibleNodeIds!.has(node.id)) continue;
      const tc = node.track_count ?? 0;
      if (trackCountMinEffective != null && tc < trackCountMinEffective) continue;
      if (trackCountMaxEffective != null && tc > trackCountMaxEffective) continue;
      out.add(node.id);
    }
    return out;
  }, [nodes, collabVisibleNodeIds, trackCountMinEffective, trackCountMaxEffective]);

  const networkAdvAllowedIds = useMemo(() => {
    if (!networkAdvFilterApplied || !hasActiveConditions(networkAdvFilterApplied)) return null;
    const needsStreams = networkFilterUsesStreamFields(networkAdvFilterApplied);
    if (needsStreams) {
      if (networkAdvStreamStatsLoading) return null;
      if (networkAdvStreamStatsError) return new Set<string>();
    }
    return filterNetworkArtistsClientSide(
      networkAdvFilterApplied,
      nodes,
      edges,
      needsStreams ? (networkAdvStreamStats ?? undefined) : undefined,
    );
  }, [
    networkAdvFilterApplied,
    nodes,
    edges,
    networkAdvStreamStats,
    networkAdvStreamStatsLoading,
    networkAdvStreamStatsError,
  ]);

  useEffect(() => {
    if (!networkAdvFilterApplied || !hasActiveConditions(networkAdvFilterApplied)) {
      setNetworkAdvStreamStats(null);
      setNetworkAdvStreamStatsError(null);
      setNetworkAdvStreamStatsLoading(false);
      return;
    }
    if (!networkFilterUsesStreamFields(networkAdvFilterApplied)) {
      setNetworkAdvStreamStats(null);
      setNetworkAdvStreamStatsError(null);
      setNetworkAdvStreamStatsLoading(false);
      return;
    }

    const artistIds = nodes.map((n) => n.id).filter((id) => String(id).trim().length > 0);
    if (artistIds.length === 0) {
      setNetworkAdvStreamStats(new Map());
      setNetworkAdvStreamStatsError(null);
      setNetworkAdvStreamStatsLoading(false);
      return;
    }

    let cancelled = false;
    setNetworkAdvStreamStatsLoading(true);
    setNetworkAdvStreamStatsError(null);

    void fetchApiJson<{
      rows?: Array<{
        artist_id: string;
        total_streams_in_scope: number | string | null;
        daily_streams_in_scope: number | string | null;
      }>;
    }>("/api/admin/network-export-artist-stream-stats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        artistIds,
        playlistKey: playlistKey ?? null,
        hideNonPrimary,
      }),
    })
      .then((j) => {
        if (cancelled) return;
        const m = new Map<string, NetworkArtistStreamStatsRow>();
        for (const row of j.rows ?? []) {
          m.set(row.artist_id, {
            total_streams_in_scope: Number(row.total_streams_in_scope ?? 0) || 0,
            daily_streams_in_scope: Number(row.daily_streams_in_scope ?? 0) || 0,
          });
        }
        setNetworkAdvStreamStats(m);
        setNetworkAdvStreamStatsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setNetworkAdvStreamStats(null);
        setNetworkAdvStreamStatsError("Failed to load stream stats for advanced filter.");
        setNetworkAdvStreamStatsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [networkAdvFilterApplied, playlistKey, hideNonPrimary, nodes]);

  /** Toolbar filters ∩ advanced modal filter (full graph used to evaluate advanced rules). */
  const combinedVisibleNodeIds = useMemo(() => {
    const all = new Set(nodes.map((n) => n.id));
    const toolbar = filteredVisibleNodeIds ?? all;
    const adv = networkAdvAllowedIds ?? all;
    const out = new Set<string>();
    for (const id of toolbar) {
      if (adv.has(id)) out.add(id);
    }
    return out;
  }, [filteredVisibleNodeIds, networkAdvAllowedIds, nodes]);

  useEffect(() => {
    setRangeSelection((prev) => {
      const next = prev.filter((id) => combinedVisibleNodeIds.has(id));
      return next.length === prev.length ? prev : next;
    });
    setSelectedNodeId((prev) => {
      if (!prev) return null;
      return combinedVisibleNodeIds.has(prev) ? prev : null;
    });
  }, [combinedVisibleNodeIds]);

  const neighborsView = useMemo(() => {
    const fe = edges.filter(
      (e) => combinedVisibleNodeIds.has(e.source) && combinedVisibleNodeIds.has(e.target),
    );
    return buildAdjacency(fe).neighbors;
  }, [edges, combinedVisibleNodeIds]);

  const collabDegreeMatchesFilter = useCallback(
    (deg: number) => coartistCountInRange(deg, collabFilterMin, collabFilterMax),
    [collabFilterMin, collabFilterMax],
  );

  const nodePassesTrackCountBounds = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return false;
      const tc = node.track_count ?? 0;
      if (trackCountMinEffective != null && tc < trackCountMinEffective) return false;
      if (trackCountMaxEffective != null && tc > trackCountMaxEffective) return false;
      return true;
    },
    [nodes, trackCountMinEffective, trackCountMaxEffective],
  );

  useEffect(() => {
    if (!collabRangeIsActive(collabFilterMin, collabFilterMax)) return;
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
  }, [collabFilterMin, collabFilterMax, trackCollabFilterMap, collabDegreeMatchesFilter]);

  useEffect(() => {
    if (trackCountMinEffective == null && trackCountMaxEffective == null) return;
    setRangeSelection((prev) => {
      const next = prev.filter((id) => nodePassesTrackCountBounds(id));
      return next.length === prev.length ? prev : next;
    });
    setSelectedNodeId((prev) => {
      if (!prev) return null;
      return nodePassesTrackCountBounds(prev) ? prev : null;
    });
  }, [trackCountMinEffective, trackCountMaxEffective, nodePassesTrackCountBounds]);

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
      `${networkScopeIdentityStr}|${hideNonPrimary ? "1" : "0"}|${nodeIdKey}|c:${collabFilterMin ?? "x"}:${collabFilterMax ?? "x"}|b:${collabCountBasis}|tc:${trackCountMinEffective ?? "x"}:${trackCountMaxEffective ?? "x"}|tbl:${tableView ? "1" : "0"}`,
    [
      networkScopeIdentityStr,
      hideNonPrimary,
      nodeIdKey,
      collabFilterMin,
      collabFilterMax,
      collabCountBasis,
      trackCountMinEffective,
      trackCountMaxEffective,
      tableView,
    ],
  );

  const graphData = useMemo(() => {
    const fnodes = nodes.filter((n) => combinedVisibleNodeIds.has(n.id)).map((n) => ({ ...n }));
    const flinks = edges
      .filter((e) => combinedVisibleNodeIds.has(e.source) && combinedVisibleNodeIds.has(e.target))
      .map((e) => ({ ...e }));
    return { nodes: fnodes, links: flinks };
  }, [nodes, edges, combinedVisibleNodeIds]);

  /** Screen hit-test aligned with `nodePointerAreaPaint` (touch long-press → distro modal). */
  const pickVisibleNodeAtClientPos = useCallback(
    (clientX: number, clientY: number): FGNodeObj | null => {
      const fg = fgRef.current;
      const host = containerRef.current;
      if (!fg || !host) return null;
      const r = host.getBoundingClientRect();
      const px = clientX - r.left;
      const py = clientY - r.top;
      if (px < 0 || py < 0 || px > dimensions.width || py > dimensions.height) return null;
      let k: number;
      try {
        k = fg.zoom();
      } catch {
        return null;
      }
      if (!Number.isFinite(k) || k < 0.001) return null;

      let best: FGNodeObj | null = null;
      let bestD = Infinity;
      for (const n of graphData.nodes as FGNodeObj[]) {
        const nx = n.x;
        const ny = n.y;
        if (!Number.isFinite(nx) || !Number.isFinite(ny)) continue;
        const gx = nx as number;
        const gy = ny as number;
        const baseSize = scaleByTracks
          ? scaleLinear(n.track_count ?? 1, minTrackCount, maxTrackCount, 3, 16)
          : 5;
        const hitSize = Math.max(baseSize, 6);
        const hitR = hitSize * k;
        let scr: { x: number; y: number };
        try {
          scr = fg.graph2ScreenCoords(gx, gy);
        } catch {
          continue;
        }
        const dx = px - scr.x;
        const dy = py - scr.y;
        const d = Math.hypot(dx, dy);
        if (d <= hitR && d < bestD) {
          bestD = d;
          best = n;
        }
      }
      return best;
    },
    [
      dimensions.width,
      dimensions.height,
      graphData.nodes,
      scaleByTracks,
      minTrackCount,
      maxTrackCount,
    ],
  );

  const visibleTableArtistIdsKey = useMemo(
    () =>
      [...graphData.nodes]
        .map((n) => String(n.id).trim())
        .filter((id) => id.length > 0)
        .sort()
        .join("\0"),
    [graphData.nodes],
  );

  useEffect(() => {
    if (!tableView) {
      setTableStreamStats(null);
      setTableStreamStatsLoading(false);
      setTableStreamStatsError(false);
      return;
    }
    if (!visibleTableArtistIdsKey) {
      setTableStreamStats(new Map());
      setTableStreamStatsLoading(false);
      setTableStreamStatsError(false);
      return;
    }
    const artistIds = visibleTableArtistIdsKey.split("\0");
    let cancelled = false;
    setTableStreamStatsLoading(true);
    setTableStreamStatsError(false);
    fetchApiJson<{
      rows?: Array<{
        artist_id: string;
        total_streams_in_scope: number;
        daily_streams_in_scope: number;
        tracks_all_catalog: number;
        total_streams_all_catalog: number;
        daily_streams_all_catalog: number;
      }>;
    }>("/api/admin/network-export-artist-stream-stats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        artistIds,
        playlistKey: playlistKey ?? null,
        hideNonPrimary,
      }),
    })
      .then((js) => {
        if (cancelled) return;
        const m = new Map<string, NetworkArtistStreamExportRow>();
        for (const row of js.rows ?? []) {
          m.set(row.artist_id, {
            total_streams_in_scope: row.total_streams_in_scope,
            daily_streams_in_scope: row.daily_streams_in_scope,
            tracks_all_catalog: row.tracks_all_catalog,
            total_streams_all_catalog: row.total_streams_all_catalog,
            daily_streams_all_catalog: row.daily_streams_all_catalog,
          });
        }
        setTableStreamStats(m);
        setTableStreamStatsLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setTableStreamStats(null);
          setTableStreamStatsError(true);
          setTableStreamStatsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [tableView, visibleTableArtistIdsKey, playlistKey, hideNonPrimary]);

  const handleExportViewXlsx = useCallback(async () => {
    if (isCompetitorDataset) {
      setXlsxExportAlert("Excel export is not available in Competitor Mode yet.");
      return;
    }
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
          const js = await fetchApiJson<{
            rows?: Array<{
              artist_id: string;
              total_streams_in_scope: number;
              daily_streams_in_scope: number;
              tracks_all_catalog: number;
              total_streams_all_catalog: number;
              daily_streams_all_catalog: number;
            }>;
          }>("/api/admin/network-export-artist-stream-stats", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              artistIds: artistIdsForStats,
              playlistKey: playlistKey ?? null,
              hideNonPrimary,
            }),
          });
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
        let j: {
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
        };
        try {
          j = await fetchApiJson("/api/admin/isrc-batch-details", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ isrcs: part }),
          });
        } catch (e) {
          trackEnrichmentBatchFailures += 1;
          console.error("isrc-batch-details for export:", e);
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
    networkScopeIdentityStr,
    collabCountBasisLabel,
    isCompetitorDataset,
  ]);

  const selectionHydrateKey = useMemo(
    () => `${nodeIdKey}\0${searchParams.get("sel") ?? ""}`,
    [nodeIdKey, searchParams],
  );

  const rangeSet = useMemo(() => new Set(rangeSelection), [rangeSelection]);

  const pushNetworkUrl = useCallback(
    (patch: Partial<{
      scope: NetworkScopeState;
      hideNonPrimary: boolean;
      scaleByTracks: boolean;
      showImages: boolean;
      tableView: boolean;
      collabMin: number | null;
      collabMax: number | null;
      collabCountBasis: CollabCountBasis;
      trackCountMin: number | null;
      trackCountMax: number | null;
      selectedIds: string[];
      tableSortKey: NetworkTableSortKey;
      tableSortDir: "asc" | "desc";
    }>) => {
      const scope = patch.scope ?? scopeRef.current;
      const q = buildNetworkQueryString({
        scope,
        hideNonPrimary: patch.hideNonPrimary ?? hideNonPrimary,
        scaleByTracks: patch.scaleByTracks ?? scaleByTracks,
        showImages: patch.showImages ?? showImages,
        tableView: patch.tableView ?? tableView,
        collabMin: patch.collabMin !== undefined ? patch.collabMin : collabFilterMin,
        collabMax: patch.collabMax !== undefined ? patch.collabMax : collabFilterMax,
        collabCountBasis: patch.collabCountBasis ?? collabCountBasis,
        trackCountMin: patch.trackCountMin !== undefined ? patch.trackCountMin : trackCountMin,
        trackCountMax: patch.trackCountMax !== undefined ? patch.trackCountMax : trackCountMax,
        selectedIds: patch.selectedIds ?? rangeSelection,
        tableSortKey: patch.tableSortKey ?? tableSort.key,
        tableSortDir: patch.tableSortDir ?? tableSort.dir,
      });
      router.replace((pathname || "/network") + q, { scroll: false });
    },
    [
      pathname,
      router,
      tableSort.key,
      tableSort.dir,
      hideNonPrimary,
      scaleByTracks,
      showImages,
      tableView,
      collabFilterMin,
      collabFilterMax,
      collabCountBasis,
      trackCountMin,
      trackCountMax,
      rangeSelection,
    ],
  );

  const commitCollabRange = useCallback(() => {
    let min = parseCollabInputDraft(collabMinDraft);
    let max = parseCollabInputDraft(collabMaxDraft);
    if (min != null && max != null && min > max) {
      [min, max] = [max, min];
    }
    setCollabFilterMin(min);
    setCollabFilterMax(max);
    setCollabMinDraft(min == null ? "" : String(min));
    setCollabMaxDraft(max == null ? "" : String(max));
    pushNetworkUrl({ collabMin: min, collabMax: max });
  }, [collabMinDraft, collabMaxDraft, pushNetworkUrl]);

  const cycleTableSortColumn = useCallback(
    (key: NetworkTableSortKey) => {
      const cur = parseNetworkTableSort(searchParams);
      const nextDir: "asc" | "desc" =
        cur.key === key ? (cur.dir === "asc" ? "desc" : "asc") : "asc";
      pushNetworkUrl({ tableSortKey: key, tableSortDir: nextDir });
    },
    [searchParams, pushNetworkUrl],
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
      scope: scopeRef.current,
      hideNonPrimary,
      scaleByTracks,
      showImages,
      tableView,
      collabMin: collabFilterMin,
      collabMax: collabFilterMax,
      collabCountBasis,
      trackCountMin,
      trackCountMax,
      selectedIds: rangeSelection,
      tableSortKey: tableSort.key,
      tableSortDir: tableSort.dir,
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
    tableView,
    collabFilterMin,
    collabFilterMax,
    collabCountBasis,
    trackCountMin,
    trackCountMax,
    networkScopeIdentityStr,
    hideNonPrimary,
    pathname,
    router,
    tableSort.key,
    tableSort.dir,
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

  const selectionTotalsFetchKey = useMemo(() => {
    if (rangeSelection.length === 0) return "";
    return `${[...rangeSelection].sort().join("\0")}\0${networkScopeIdentityStr}\0${hideNonPrimary ? "1" : "0"}`;
  }, [rangeSelection, networkScopeIdentityStr, hideNonPrimary]);

  useEffect(() => {
    if (selectionTotalsFetchKey === "") {
      setStreamTotals({ total: null, daily: null, trackCount: null, loading: false });
      return;
    }
    let cancelled = false;
    setStreamTotals((s) => ({ ...s, loading: true }));
    fetchApiJson<{
      trackCount?: unknown;
      totalStreams?: unknown;
      dailyStreams?: unknown;
    }>("/api/admin/network-selection-stream-totals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        artistIds: rangeSelection,
        playlistKey: playlistKey ?? null,
        hideNonPrimary,
      }),
    })
      .then((j) => {
        if (cancelled) return;
        setStreamTotals({
          total: typeof j.totalStreams === "number" ? j.totalStreams : null,
          daily: typeof j.dailyStreams === "number" ? j.dailyStreams : null,
          trackCount: typeof j.trackCount === "number" ? j.trackCount : null,
          loading: false,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setStreamTotals({ total: null, daily: null, trackCount: null, loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [selectionTotalsFetchKey, rangeSelection, playlistKey, hideNonPrimary, networkScopeIdentityStr]);

  useEffect(() => {
    if (rangeSelection.length === 0) {
      setSelectionCollabsModalOpen(false);
      setSelectionScopedTracksOpen(false);
    }
  }, [rangeSelection.length]);

  // Search results
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    let list = nodes.filter((n) => n.name.toLowerCase().includes(q));
    list = list.filter((n) => combinedVisibleNodeIds.has(n.id));
    return list.slice(0, 12);
  }, [nodes, searchQuery, combinedVisibleNodeIds]);

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

  // Drop frozen link tooltip if focus mode changes and that edge is no longer in the highlighted set.
  useEffect(() => {
    if (!pinnedLink) return;
    if (!isLinkHighlighted(pinnedLink)) clearPinnedLink();
  }, [pinnedLink, isLinkHighlighted, clearPinnedLink, selectedNodeId, rangeSelection]);

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
      let width = Math.min(w * 0.8, 6);
      const key = collaborationLinkKey(link);
      const hoverOrPin =
        (hoveredLink != null && collaborationLinkKey(hoveredLink) === key) ||
        (pinnedLink != null && collaborationLinkKey(pinnedLink) === key);
      if (hoverOrPin) width = Math.min(width + 1.25, 8);
      return width;
    },
    [hoveredLink, pinnedLink],
  );

  const linkColor = useCallback(
    (link: FGLinkObj) => {
      const hl = isLinkHighlighted(link);
      if (!hl) return colors.isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)";
      const w = (link as unknown as GraphEdge).weight ?? 1;
      let a = Math.min(0.15 + w * 0.1, 0.6);
      const key = collaborationLinkKey(link);
      const isHover =
        hoveredLink != null && collaborationLinkKey(hoveredLink) === key;
      const isPinned =
        pinnedLink != null && collaborationLinkKey(pinnedLink) === key;
      // Brighter stroke for interactive focus: hover preview or frozen tooltip anchor.
      if (isHover || isPinned) {
        a = Math.min(a + 0.24, 0.92);
      }
      return accentRgba(colors.accent, a);
    },
    [isLinkHighlighted, colors, hoveredLink, pinnedLink],
  );

  /** World-space grid (pans/zooms with the graph) for spatial reference while navigating. */
  const onRenderFramePre = useCallback(
    (ctx: CanvasRenderingContext2D, globalScale: number) => {
      const fg = fgRef.current;
      const w = dimensions.width;
      const h = dimensions.height;
      if (!fg || w < 8 || h < 8 || !Number.isFinite(globalScale) || globalScale < 0.001) return;
      if (!showBackgroundGrid) return;

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
    [dimensions.width, dimensions.height, colors.isDark, showBackgroundGrid],
  );

  const closeDistroModal = useCallback(() => {
    setDistroModalOpen(false);
    setDistroLoading(false);
    setDistroError(null);
    setDistroPlaylists([]);
    setDistroTracks([]);
    setDistroNameMap(new Map());
  }, []);

  const switchCompetitorLabel = useCallback(
    async (labelKey: string) => {
      try {
        await fetchApiJson<{ dataset_mode?: string; competitor_label_key?: string }>(
          "/api/user-settings/dataset-context",
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dataset_mode: "competitor", competitor_label_key: labelKey }),
          },
        );
        dispatchCompetitorLabelChange({ labelKey, accentHex: null });
        router.refresh();
      } catch (e) {
        console.error("switch competitor label failed:", e);
      }
    },
    [router],
  );

  const openArtistDistroModal = useCallback(async (artistId: string, fallbackName: string) => {
    setDistroModalOpen(true);
    setDistroLoading(true);
    setDistroError(null);
    setDistroArtistName(fallbackName);
    setDistroPlaylists([]);
    setDistroTracks([]);
    setDistroNameMap(new Map());
    try {
      const json = await fetchApiJson<{
        artistName?: string;
        playlists?: DistroPlaylist[];
        tracks?: ArtistDistroTrackRow[];
        nameByArtistId?: Record<string, string>;
      }>(`/api/admin/artist-distro-tracks?artist_id=${encodeURIComponent(artistId)}`);
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
      if (suppressNextNodeClickRef.current) {
        suppressNextNodeClickRef.current = false;
        event.preventDefault?.();
        event.stopPropagation?.();
        return;
      }
      if (isCrossLabelMode) {
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          event.stopPropagation();
          void switchCompetitorLabel(id);
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
        return;
      }
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
    [selectedNodeId, openArtistDistroModal, isCrossLabelMode, switchCompetitorLabel],
  );

  const handleBackgroundClick = useCallback(() => {
    setSelectedNodeId(null);
    setRangeSelection([]);
    clearPinnedLink();
    clearLinkPinLongPress();
  }, [clearPinnedLink, clearLinkPinLongPress]);

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

      lastPointerClientRef.current = { x: e.clientX, y: e.clientY };
      lastContainerPointerTypeRef.current = e.pointerType;
      lastPointerIdRef.current = e.pointerId;

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
        const hitNode = pickVisibleNodeAtClientPos(e.clientX, e.clientY);
        if (hitNode) {
          touchPointerDownRef.current = true;
          nodeDistroLongPressPointerIdRef.current = e.pointerId;
          nodeDistroLongPressStartRef.current = { x: e.clientX, y: e.clientY };
          nodeDistroLongPressTargetRef.current = {
            id: String(hitNode.id),
            name: String(hitNode.name ?? hitNode.id),
          };
          nodeDistroLongPressTimerRef.current = window.setTimeout(() => {
            nodeDistroLongPressTimerRef.current = null;
            if (!touchPointerDownRef.current) return;
            const target = nodeDistroLongPressTargetRef.current;
            clearNodeDistroLongPress();
            if (!target) return;
            try {
              void navigator.vibrate?.(25);
            } catch {
              // ignore
            }
            suppressNextNodeClickRef.current = true;
            void openArtistDistroModal(target.id, target.name);
          }, NETWORK_LONG_PRESS_MS);
          return;
        }

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
    [
      boxSelectArmed,
      clearNetworkLongPress,
      clearNodeDistroLongPress,
      pickVisibleNodeAtClientPos,
      openArtistDistroModal,
    ],
  );

  const onBoxPointerMoveCapture = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (
        nodeDistroLongPressTimerRef.current != null &&
        e.pointerId === nodeDistroLongPressPointerIdRef.current
      ) {
        const start = nodeDistroLongPressStartRef.current;
        if (start) {
          const dx = e.clientX - start.x;
          const dy = e.clientY - start.y;
          if (Math.hypot(dx, dy) > NETWORK_LONG_PRESS_MOVE_PX) {
            clearNodeDistroLongPress();
          }
        }
      }

      if (
        linkPinLongPressTimerRef.current != null &&
        e.pointerId === linkPinLongPressPointerIdRef.current
      ) {
        const start = linkPinLongPressStartRef.current;
        if (start) {
          const dx = e.clientX - start.x;
          const dy = e.clientY - start.y;
          if (Math.hypot(dx, dy) > NETWORK_LONG_PRESS_MOVE_PX) {
            clearLinkPinLongPress();
          }
        }
      }

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
    [clearNetworkLongPress, clearNodeDistroLongPress, clearLinkPinLongPress],
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
      if (e.pointerId === linkPinLongPressPointerIdRef.current) {
        clearLinkPinLongPress();
      }
      finalizeBoxSelect(e);
    },
    [clearNetworkLongPress, clearLinkPinLongPress, finalizeBoxSelect],
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

  /**
   * D3-zoom (force-graph) listens for touch events on the canvas, separate from pointer events.
   * Pointer capture + preventDefault on the container does not stop touchstart/touchmove, so the graph
   * still panned during one-finger region drag. When "Select region" is armed, ignore single-touch
   * zoom/pan in D3; two-finger touches still pass through for pinch and two-finger pan.
   */
  const graphTouchPanZoomFilter = useCallback((ev: MouseEvent) => {
    if (!boxSelectArmed) return true;
    if (typeof TouchEvent !== "undefined" && ev instanceof TouchEvent) {
      return ev.touches.length >= 2;
    }
    return true;
  }, [boxSelectArmed]);

  const handleNodeHover = useCallback((node: FGNodeObj | null) => {
    setHoveredNode(node);
    if (!node) {
      setTooltipPos(null);
    }
  }, []);

  const handleLinkHover = useCallback(
    (link: FGLinkObj | null) => {
      // When an artist (or multi-select) is focused, ignore hover on dimmed links (no tooltip / pin).
      const effective =
        link && !isLinkHighlighted(link) ? null : link;
      if (effective) {
        setHoveredLink(effective);
        const pt = lastContainerPointerTypeRef.current;
        if ((pt === "touch" || pt === "pen") && !pinnedLinkRef.current) {
          clearLinkPinLongPress();
          const key = collaborationLinkKey(effective);
          linkPinPendingKeyRef.current = key;
          linkPinLongPressStartRef.current = {
            x: lastPointerClientRef.current.x,
            y: lastPointerClientRef.current.y,
          };
          linkPinLongPressPointerIdRef.current = lastPointerIdRef.current;
          linkPinLongPressTimerRef.current = window.setTimeout(() => {
            linkPinLongPressTimerRef.current = null;
            if (linkPinPendingKeyRef.current !== key) return;
            if (pinnedLinkRef.current) return;
            if (!isLinkHighlighted(effective)) return;
            const host = containerRef.current;
            if (!host) return;
            const r = host.getBoundingClientRect();
            const p = lastPointerClientRef.current;
            try {
              void navigator.vibrate?.(25);
            } catch {
              // ignore
            }
            skipNextLinkClickRef.current = true;
            setPinnedLink(effective);
            setPinnedTooltipPos({ x: p.x - r.left, y: p.y - r.top });
            pinnedLinkKeyRef.current = key;
            window.setTimeout(() => {
              skipNextLinkClickRef.current = false;
            }, 700);
          }, NETWORK_LONG_PRESS_MS);
        }
      } else {
        clearLinkPinLongPress();
        if (!pinnedLinkRef.current) {
          setHoveredLink(null);
          setTooltipPos(null);
        }
      }
    },
    [clearLinkPinLongPress, isLinkHighlighted],
  );

  // Track mouse position for tooltip (frozen link tooltip stays at the pin point)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onMove = (e: MouseEvent) => {
      if (pinnedLinkRef.current) return;
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

  const handleTooltipArtistPrimary = useCallback(
    (artistId: string) => {
      clearPinnedLink();
      setRangeSelection([]);
      focusOnArtist(artistId);
    },
    [clearPinnedLink, focusOnArtist],
  );

  const [frozenTooltipTrackModal, setFrozenTooltipTrackModal] = useState<{
    isrc: string;
    fallbackTitle: string;
  } | null>(null);

  const [sharedTracksListModal, setSharedTracksListModal] = useState<{
    tracks: SharedTrack[];
    title: string;
  } | null>(null);

  const openSharedTracksListModal = useCallback(() => {
    const link = pinnedLink;
    if (!link) return;
    const edge = link as unknown as GraphEdge;
    const srcNode = typeof link.source === "object" ? (link.source as FGNodeObj) : null;
    const tgtNode = typeof link.target === "object" ? (link.target as FGNodeObj) : null;
    const srcName = srcNode?.name ?? String(link.source);
    const tgtName = tgtNode?.name ?? String(link.target);
    setSharedTracksListModal({
      tracks: (edge.shared_tracks ?? []) as SharedTrack[],
      title: `${srcName} × ${tgtName}`,
    });
  }, [pinnedLink]);

  const openFrozenTooltipTrackDetail = useCallback(
    (isrc: string, displayName: string) => {
      clearPinnedLink();
      setFrozenTooltipTrackModal({ isrc, fallbackTitle: displayName });
    },
    [clearPinnedLink],
  );

  const handleLinkClick = useCallback(
    (link: FGLinkObj, event: MouseEvent) => {
      if (skipNextLinkClickRef.current) {
        skipNextLinkClickRef.current = false;
        event.preventDefault?.();
        event.stopPropagation?.();
        return;
      }
      // Dimmed links (outside focused ego network / internal multi-select) act like background:
      // clear selection and exit focus mode.
      if (!isLinkHighlighted(link)) {
        event.preventDefault?.();
        event.stopPropagation?.();
        handleBackgroundClick();
        return;
      }
      if (event.ctrlKey || event.metaKey) return;

      const pte = (event as unknown as PointerEvent).pointerType;
      if (pte === "touch" || pte === "pen") return;

      event.preventDefault?.();
      event.stopPropagation?.();

      const key = collaborationLinkKey(link);
      if (pinnedLinkKeyRef.current === key) {
        clearPinnedLink();
        return;
      }

      const host = containerRef.current;
      if (!host) return;
      const r = host.getBoundingClientRect();
      setPinnedLink(link);
      setPinnedTooltipPos({ x: event.clientX - r.left, y: event.clientY - r.top });
      pinnedLinkKeyRef.current = key;
    },
    [clearPinnedLink, handleBackgroundClick, isLinkHighlighted],
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
    setCollabFilterMin(null);
    setCollabFilterMax(null);
    setCollabMinDraft("");
    setCollabMaxDraft("");
    setCollabCountBasis("playlist");
    setTrackCountMin(null);
    setTrackCountMax(null);
    setTrackCountMinDraft("");
    setTrackCountMaxDraft("");
    setTableView(false);
    setNetworkAdvFilterApplied(null);
    setNetworkAdvStreamStats(null);
    setNetworkAdvStreamStatsError(null);
    setNetworkAdvStreamStatsLoading(false);
    setNetworkAdvModalOpen(false);
    clearPinnedLink();
    clearLinkPinLongPress();
    pushNetworkUrl({
      scope: DEFAULT_NETWORK_SCOPE,
      selectedIds: [],
      collabMin: null,
      collabMax: null,
      collabCountBasis: "playlist",
      trackCountMin: null,
      trackCountMax: null,
      tableView: false,
      tableSortKey: "name",
      tableSortDir: "asc",
    });
    fgRef.current?.zoomToFit(600, 40);
  }, [pushNetworkUrl, clearPinnedLink, clearLinkPinLongPress]);

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
  }, [
    networkScopeIdentityStr,
    hideNonPrimary,
    nodeIdKey,
    collabFilterMin,
    collabFilterMax,
    collabCountBasis,
    trackCountMinEffective,
    trackCountMaxEffective,
  ]);

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
    const activeEdge = pinnedLink ?? hoveredLink;
    if (activeEdge) {
      return (
        <NetworkLinkCollaborationTooltipContent
          link={activeEdge}
          frozen={Boolean(pinnedLink)}
          accentColor={colors.accent}
          colors={colors}
          onArtistPrimary={handleTooltipArtistPrimary}
          onArtistDistroGesture={(artistId, artistName) => {
            void openArtistDistroModal(artistId, artistName);
          }}
          onFrozenTrackOpenDetail={openFrozenTooltipTrackDetail}
          onOpenSharedTracksFullList={
            pinnedLink &&
            ((pinnedLink as unknown as GraphEdge).shared_tracks?.length ?? 0) > 10
              ? openSharedTracksListModal
              : undefined
          }
        />
      );
    }
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
    return null;
  }, [
    pinnedLink,
    hoveredLink,
    hoveredNode,
    handleTooltipArtistPrimary,
    openArtistDistroModal,
    openFrozenTooltipTrackDetail,
    openSharedTracksListModal,
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
        if (networkAdvModalOpen) {
          setNetworkAdvModalOpen(false);
          return;
        }
        if (selectionScopedTracksOpen) {
          setSelectionScopedTracksOpen(false);
          return;
        }
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
        if (frozenTooltipTrackModal) {
          setFrozenTooltipTrackModal(null);
          return;
        }
        if (sharedTracksListModal) {
          setSharedTracksListModal(null);
          return;
        }
        if (pinnedLink) {
          clearPinnedLink();
          clearLinkPinLongPress();
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
    networkAdvModalOpen,
    selectionScopedTracksOpen,
    selectionCollabsModalOpen,
    distroModalOpen,
    shortcutsOpen,
    searchOpen,
    frozenTooltipTrackModal,
    sharedTracksListModal,
    pinnedLink,
    rangeSelection.length,
    selectedNodeId,
    closeDistroModal,
    clearPinnedLink,
    clearLinkPinLongPress,
  ]);

  const networkAdvAppliedCount =
    networkAdvFilterApplied && hasActiveConditions(networkAdvFilterApplied)
      ? countActiveConditions(networkAdvFilterApplied)
      : 0;

  const activeFiltersSummary = useMemo(() => {
    const parts: string[] = [];
    if (collabRangeIsActive(collabFilterMin, collabFilterMax)) {
      parts.push(
        `Co-artists ${formatCollabRangeSummary(collabFilterMin, collabFilterMax)} (${collabCountBasis === "playlist" ? "playlist-wide" : "lead rows"})`,
      );
    }
    if (trackCountMinEffective != null || trackCountMaxEffective != null) {
      const lo = trackCountMinEffective != null ? String(trackCountMinEffective) : "any";
      const hi = trackCountMaxEffective != null ? String(trackCountMaxEffective) : "any";
      parts.push(`Visible nodes: ${lo}–${hi} tracks (graph track_count)`);
    }
    if (networkAdvAppliedCount > 0) {
      const join =
        networkAdvFilterApplied?.groupJoinLogic === "OR" ? "OR between groups" : "AND between groups";
      parts.push(
        `Advanced filter (${networkAdvAppliedCount} condition${networkAdvAppliedCount !== 1 ? "s" : ""}, ${join})`,
      );
    }
    return parts;
  }, [
    collabFilterMin,
    collabFilterMax,
    collabCountBasis,
    trackCountMinEffective,
    trackCountMaxEffective,
    networkAdvAppliedCount,
    networkAdvFilterApplied,
  ]);

  /* -------- Render -------- */

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      <NetworkAdvancedFilterModal
        open={networkAdvModalOpen}
        onClose={() => setNetworkAdvModalOpen(false)}
        nodes={nodes}
        appliedFilter={networkAdvFilterApplied}
        onApply={(f) => setNetworkAdvFilterApplied(f)}
        onClearAdvanced={() => setNetworkAdvFilterApplied(null)}
      />

      <NetworkCustomScopeModal
        open={customScopeModalOpen}
        onClose={() => setCustomScopeModalOpen(false)}
        playlists={scopePlaylists}
        initialKeys={
          networkScope.mode === "custom" ? networkScope.customPlaylistKeys : []
        }
        initialMode={
          networkScope.mode === "custom" ? networkScope.customPlaylistMode : "any"
        }
        onApply={(keys, mode) => {
          pushNetworkUrl({
            scope: {
              mode: "custom",
              playlistKey: null,
              customPlaylistKeys: keys,
              customPlaylistMode: mode,
            },
          });
        }}
      />

      <Modal
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        title="Help"
        maxWidthClassName="max-w-md"
      >
        <div className="space-y-4 text-sm" style={{ color: "var(--sb-text)" }}>
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: colors.accent }}>
              Keyboard
            </h3>
            <ul className="list-none space-y-2">
              <li>
                <kbd className="rounded border px-1.5 py-0.5 font-mono text-[11px]" style={{ borderColor: "var(--sb-border)" }}>/</kbd>{" "}
                <span style={{ color: "var(--sb-muted)" }}>Focus search</span>
              </li>
              <li>
                <kbd className="rounded border px-1.5 py-0.5 font-mono text-[11px]" style={{ borderColor: "var(--sb-border)" }}>?</kbd>{" "}
                <span style={{ color: "var(--sb-muted)" }}>Open or close this panel</span>
              </li>
              <li>
                <kbd className="rounded border px-1.5 py-0.5 font-mono text-[11px]" style={{ borderColor: "var(--sb-border)" }}>Esc</kbd>{" "}
                <span style={{ color: "var(--sb-muted)" }}>
                  Close modals, then clear a pinned collaboration tooltip, then box selection, then focused artist
                </span>
              </li>
              <li>
                <kbd className="rounded border px-1.5 py-0.5 font-mono text-[11px]" style={{ borderColor: "var(--sb-border)" }}>F</kbd>{" "}
                <span style={{ color: "var(--sb-muted)" }}>Fit graph to view</span>
              </li>
            </ul>
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: colors.accent }}>
              Graph & selection
            </h3>
            <ul className="list-none space-y-2" style={{ color: "var(--sb-muted)" }}>
              <li>
                <span style={{ color: "var(--sb-text)" }}>Box select:</span> Alt+drag on desktop, or turn on{" "}
                <span style={{ color: "var(--sb-text)", fontWeight: 600 }}>Select region</span> then drag.
              </li>
              <li>
                <span style={{ color: "var(--sb-text)" }}>Distro tracks:</span> Ctrl/Cmd+click an artist node on desktop. Touch /
                pen: press and hold ~{(NETWORK_LONG_PRESS_MS / 1000).toFixed(2)}s on a node (keep still; same timing as charts).
              </li>
              <li>
                <span style={{ color: "var(--sb-text)" }}>Collaboration edges:</span> hover for shared tracks. Click an edge
                (desktop) or press and hold ~{(NETWORK_LONG_PRESS_MS / 1000).toFixed(2)}s (touch / pen) to pin a rich tooltip
                (artist avatars, track list). In the pinned tooltip: click a track for stream/revenue details and distro
                playlists; Ctrl/⌘+click or long-press an artist for distro tracks (same as a node). Dismiss: canvas background,
                click the same edge again, or Esc.
              </li>
              <li>
                Touch / pen on empty canvas: hold still ~{(NETWORK_LONG_PRESS_MS / 1000).toFixed(2)}s, then drag a box. Dragging
                without holding pans the graph. <span style={{ color: "var(--sb-text)", fontWeight: 600 }}>Select region</span>{" "}
                starts a marquee immediately.
              </li>
              <li>
                A faint grid moves with the graph. Zooming in can show finer dashed lines; x=0 and y=0 are slightly bolder when
                visible.
              </li>
            </ul>
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: colors.accent }}>
              Toolbar filters
            </h3>
            <ul className="list-none space-y-2" style={{ color: "var(--sb-muted)" }}>
              <li>
                <span style={{ color: "var(--sb-text)" }}>Graph scope</span> (dropdown): all catalog, one playlist, or{" "}
                <span style={{ color: "var(--sb-text)" }}>Custom playlist scope…</span> (modal: Any of / All of / Not in
                selected playlists). Custom scopes use URL params{" "}
                <code className="font-mono text-[11px]">net_scope=custom</code>,{" "}
                <code className="font-mono text-[11px]">net_pl</code>,{" "}
                <code className="font-mono text-[11px]">net_pl_m</code>.
              </li>
              <li>
                <span style={{ color: "var(--sb-text)" }}>Co-artists</span>: min / max 0–999 (either or both; blank = open bound),
                blur or Enter to apply. <span style={{ color: "var(--sb-text)" }}>Playlist</span> vs{" "}
                <span style={{ color: "var(--sb-text)" }}>Lead only</span> changes what we count as a co-artist.
              </li>
              <li>
                <span style={{ color: "var(--sb-text)" }}>Node tracks</span> filters by each node&apos;s in-scope{" "}
                <code className="font-mono text-[11px]">track_count</code> (min / max).
              </li>
            </ul>
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: colors.accent }}>
              Toggles
            </h3>
            <ul className="list-none space-y-2" style={{ color: "var(--sb-muted)" }}>
              <li>
                <span style={{ color: "var(--sb-text)" }}>Scale by tracks</span> — node size from catalog track count.
              </li>
              <li>
                <span style={{ color: "var(--sb-text)" }}>Show images</span> — avatars on nodes when available.
              </li>
              <li>
                <span style={{ color: "var(--sb-text)" }}>Hide non-primary</span> — drop artists with no lead track in scope.
              </li>
              <li>
                <span style={{ color: "var(--sb-text)" }}>Table</span> — sortable list of visible artists (avatars, sticky
                header, row activates the graph, in-scope totals from the same API as the Excel Artists sheet). Values follow the
                global metric (Streams / Revenue / Tracks→Streams) and payout rate like catalog tables. Sort order is stored in the
                URL (
                <code className="font-mono text-[11px]">tbl_sort</code>,{" "}
                <code className="font-mono text-[11px]">tbl_dir</code>).
              </li>
              <li>
                <span style={{ color: "var(--sb-text)" }}>Funnel</span> — advanced filters: AND/OR inside each group, and when
                you add multiple groups, <span style={{ color: "var(--sb-text)", fontWeight: 600 }}>Combine groups</span> chooses
                AND vs OR between them. Save/load presets in the modal (this device).
              </li>
            </ul>
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: colors.accent }}>
              Export & link
            </h3>
            <p className="text-[13px] leading-snug" style={{ color: "var(--sb-muted)" }}>
              Download builds a multi-sheet <code className="font-mono text-[11px]">.xlsx</code> (Summary, Artists,
              Collaborations, Tracks, Tracks unique) for the current scope and toolbar filters.
            </p>
            <p className="text-[13px] leading-snug mt-2" style={{ color: "var(--sb-muted)" }}>
              Copy the address bar URL to share the view. Anyone signed in as an{" "}
              <span style={{ color: "var(--sb-text)" }}>admin</span> can open it and get the same scope, toolbar filters, table
              on/off, table sort, and multi-select (<code className="font-mono text-[11px]">sel=</code>, up to {MAX_SEL_URL}{" "}
              ids).
            </p>
            <p className="text-[13px] leading-snug mt-2" style={{ color: "var(--sb-muted)" }}>
              The URL encodes scope (<code className="font-mono text-[11px]">playlist=…</code> or custom{" "}
              <code className="font-mono text-[11px]">net_scope</code> / <code className="font-mono text-[11px]">net_pl</code> /{" "}
              <code className="font-mono text-[11px]">net_pl_m</code>), toggles,{" "}
              <code className="font-mono text-[11px]">collab_min</code> /{" "}
              <code className="font-mono text-[11px]">collab_max</code> (inclusive range; either or both),{" "}
              <code className="font-mono text-[11px]">co_basis=primary</code>,{" "}
              <code className="font-mono text-[11px]">tc_min</code> / <code className="font-mono text-[11px]">tc_max</code>,{" "}
              <code className="font-mono text-[11px]">table=1</code>,{" "}
              <code className="font-mono text-[11px]">tbl_sort</code> / <code className="font-mono text-[11px]">tbl_dir</code>{" "}
              (including <code className="font-mono text-[11px]">streams_total</code> /{" "}
              <code className="font-mono text-[11px]">streams_daily</code>).
            </p>
            <p className="text-[13px] leading-snug mt-2" style={{ color: "var(--sb-muted)" }}>
              The advanced filter (<span style={{ color: "var(--sb-text)" }}>Funnel</span>) is not stored in the URL — presets
              stay on this device; pan/zoom is saved in local storage per graph identity. Re-apply the funnel or align the camera
              after opening a shared link.
            </p>
          </section>
        </div>
      </Modal>

      {/* Controls bar */}
      <div
        className="flex items-center gap-3 px-4 py-2.5 flex-wrap border-b"
        style={{
          borderColor: colors.border,
          backgroundColor: colors.card,
        }}
      >
        {/* Graph scope */}
        {isCrossLabelMode ? (
          <span
            className="text-sm font-medium shrink-0"
            style={{ color: colors.text }}
            title="Shared tracks between competitor labels (current playlist memberships)"
          >
            Competitor overlap
          </span>
        ) : (
          <MenuSelect
            value={scopeMenuValue}
            options={playlistScopeOptions}
            onChange={(v) => {
              if (v === SCOPE_CATALOG) {
                pushNetworkUrl({ scope: DEFAULT_NETWORK_SCOPE });
                return;
              }
              if (v === SCOPE_CUSTOM) {
                setCustomScopeModalOpen(true);
                return;
              }
              pushNetworkUrl({
                scope: {
                  mode: "playlist",
                  playlistKey: v,
                  customPlaylistKeys: [],
                  customPlaylistMode: "any",
                },
              });
            }}
            ariaLabel="Graph scope: catalog, playlist, or custom playlists"
            placeholder={catalogScopeLabel}
            matchTriggerWidth={false}
            className="min-w-[10rem] max-w-[min(100vw-8rem,17rem)]"
            menuClassName="max-h-80 min-w-[min(100vw-2rem,17rem)] overflow-y-auto"
          />
        )}

        {!isCrossLabelMode ? (
        <div
          className="flex flex-wrap items-center gap-1.5 rounded-lg px-2 py-1 text-[11px]"
          style={{
            backgroundColor: colors.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
            color: colors.text,
          }}
        >
          <span
            className="shrink-0 pl-0.5"
            style={{ color: colors.muted }}
            title="Filter artists by how many distinct other artists share at least one in-scope track with them. Min and max are inclusive (0–999); leave either blank for no bound. Blur or press Enter to apply. Use Playlist vs Lead only to choose how co-artists are counted."
          >
            Co-artists
          </span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="Min"
            aria-label="Minimum co-artist count on tracks (inclusive)"
            className="w-11 min-w-0 rounded px-1.5 py-1 font-mono text-xs tabular-nums outline-none border"
            style={{
              borderColor: colors.border,
              backgroundColor: colors.isDark ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.7)",
              color: colors.text,
            }}
            value={collabMinDraft}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "" || /^\d*$/.test(v)) setCollabMinDraft(v);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              }
            }}
            onBlur={commitCollabRange}
          />
          <span style={{ color: colors.muted }}>–</span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="Max"
            aria-label="Maximum co-artist count on tracks (inclusive)"
            className="w-11 min-w-0 rounded px-1.5 py-1 font-mono text-xs tabular-nums outline-none border"
            style={{
              borderColor: colors.border,
              backgroundColor: colors.isDark ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.7)",
              color: colors.text,
            }}
            value={collabMaxDraft}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "" || /^\d*$/.test(v)) setCollabMaxDraft(v);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              }
            }}
            onBlur={commitCollabRange}
          />
          <div className="flex rounded-md overflow-hidden border shrink-0" style={{ borderColor: colors.border }}>
            <button
              type="button"
              className="px-2 py-1 font-medium transition-colors"
              aria-label="Co-artist count: playlist-wide (any credit on scoped tracks)"
              title="Playlist: count distinct co-artists from every credit on in-scope tracks—any position on the track, not only where this artist is lead."
              style={{
                backgroundColor:
                  collabCountBasis === "playlist"
                    ? accentRgba(colors.accent, colors.isDark ? 0.14 : 0.2)
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
              aria-label="Co-artist count: lead rows only"
              title="Lead only: count co-artists only on ISRCs where this artist is the primary (first Spotify credit) on that track."
              style={{
                borderColor: colors.border,
                backgroundColor:
                  collabCountBasis === "primary_rows"
                    ? accentRgba(colors.accent, colors.isDark ? 0.14 : 0.2)
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
        ) : null}

        <div
          className="flex flex-wrap items-center gap-1.5 rounded-lg px-2 py-1 text-[11px]"
          style={{
            backgroundColor: colors.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
            color: colors.text,
          }}
        >
          <span
            className="shrink-0 pl-0.5"
            style={{ color: colors.muted }}
            title="Filter visible nodes by each artist's in-scope track count (the same track_count used on the graph). Min and max are inclusive; leave blank for no bound."
          >
            {isCrossLabelMode ? "Label tracks" : "Node tracks"}
          </span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="Min"
            aria-label="Minimum in-scope track count on graph nodes"
            className="w-14 min-w-0 rounded px-1.5 py-1 font-mono text-xs tabular-nums outline-none border"
            style={{
              borderColor: colors.border,
              backgroundColor: colors.isDark ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.7)",
              color: colors.text,
            }}
            value={trackCountMinDraft}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "" || /^\d*$/.test(v)) setTrackCountMinDraft(v);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              }
            }}
            onBlur={() => {
              const parsed = parseTrackCountInputDraft(trackCountMinDraft);
              setTrackCountMin(parsed);
              setTrackCountMinDraft(parsed == null ? "" : String(parsed));
              pushNetworkUrl({ trackCountMin: parsed });
            }}
          />
          <span style={{ color: colors.muted }}>–</span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="Max"
            aria-label="Maximum in-scope track count on graph nodes"
            className="w-14 min-w-0 rounded px-1.5 py-1 font-mono text-xs tabular-nums outline-none border"
            style={{
              borderColor: colors.border,
              backgroundColor: colors.isDark ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.7)",
              color: colors.text,
            }}
            value={trackCountMaxDraft}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "" || /^\d*$/.test(v)) setTrackCountMaxDraft(v);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              }
            }}
            onBlur={() => {
              const parsed = parseTrackCountInputDraft(trackCountMaxDraft);
              setTrackCountMax(parsed);
              setTrackCountMaxDraft(parsed == null ? "" : String(parsed));
              pushNetworkUrl({ trackCountMax: parsed });
            }}
          />
        </div>

        {/* Icon toggles before search so narrow viewports don’t place Scale/Images on a row beside the search field */}
        <div className="flex flex-nowrap items-center gap-1.5 sm:gap-2 shrink-0 overflow-x-auto min-w-0 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          <ToggleButton
            active={scaleByTracks}
            onClick={() => pushNetworkUrl({ scaleByTracks: !scaleByTracks })}
            icon={<Scaling size={14} />}
            title="Scale by tracks"
            colors={colors}
          />

          <ToggleButton
            active={showImages}
            onClick={() => pushNetworkUrl({ showImages: !showImages })}
            icon={<ImageIcon size={14} />}
            title="Show images"
            colors={colors}
          />

          <ToggleButton
            active={boxSelectArmed}
            onClick={() => setBoxSelectArmed((v) => !v)}
            icon={<SquareDashed size={14} />}
            title="Select region"
            colors={colors}
          />

          {!isCrossLabelMode ? (
            <ToggleButton
              active={hideNonPrimary}
              onClick={() => pushNetworkUrl({ hideNonPrimary: !hideNonPrimary })}
              icon={<UserX size={14} />}
              title="Hide non-primary"
              colors={colors}
            />
          ) : null}

          <ToggleButton
            active={tableView}
            onClick={() => pushNetworkUrl({ tableView: !tableView })}
            icon={<Table2 size={14} />}
            title="Table view"
            colors={colors}
          />

          <IconButton
            type="button"
            variant="ghost"
            size="sm"
            title="Advanced filters"
            aria-label="Open advanced artist filters"
            onClick={() => setNetworkAdvModalOpen(true)}
            className="!h-8 !w-8 shrink-0 !rounded-lg"
            style={{
              color: networkAdvAppliedCount > 0 ? colors.accent : colors.muted,
              backgroundColor:
                networkAdvAppliedCount > 0
                  ? accentRgba(colors.accent, colors.isDark ? 0.12 : 0.15)
                  : colors.isDark
                    ? "rgba(255,255,255,0.06)"
                    : "rgba(0,0,0,0.04)",
            }}
          >
            <Filter className="h-3.5 w-3.5" aria-hidden />
          </IconButton>

          <div className="w-px h-5 shrink-0 self-center" style={{ backgroundColor: colors.border }} />

          {xlsxExportPhase ? (
            <span
              className="text-[11px] tabular-nums truncate max-w-[7rem] sm:max-w-[14rem] shrink-0"
              style={{ color: colors.muted }}
            >
              {xlsxExportPhase}
            </span>
          ) : null}

          <IconButton
            type="button"
            variant="ghost"
            size="sm"
            title={
              isCompetitorDataset
                ? "Excel export is not available in Competitor Mode yet"
                : "Download Excel"
            }
            aria-label="Download Excel export of current network view"
            disabled={xlsxExporting || isCompetitorDataset}
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
            title="Help"
            aria-label="Help and shortcuts"
            onClick={() => setShortcutsOpen(true)}
            className="!h-8 !w-8 shrink-0 !rounded-lg"
            style={{
              color: colors.muted,
              backgroundColor: colors.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
            }}
          >
            <HelpCircle className="h-3.5 w-3.5" aria-hidden />
          </IconButton>

          <IconButton
            type="button"
            variant="ghost"
            size="sm"
            title="Reset"
            aria-label="Reset network view — clear selection, filters, search, saved camera; fit graph"
            onClick={handleReset}
            className="!h-8 !w-8 shrink-0 !rounded-lg"
            style={{
              color: colors.muted,
              backgroundColor: colors.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          </IconButton>
        </div>

        <div className="w-px h-5 max-sm:hidden shrink-0" style={{ backgroundColor: colors.border }} />

        {/* Search */}
        <div className="relative min-w-0 w-full max-sm:basis-full sm:w-auto sm:max-w-md shrink sm:shrink-0">
          <div
            className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm w-full min-w-0"
            style={{
              backgroundColor: colors.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
              color: colors.text,
            }}
          >
            <Search size={14} className="shrink-0" style={{ color: colors.muted }} />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search artist…"
              className="bg-transparent outline-none min-w-0 flex-1 sm:w-44 sm:flex-initial placeholder:opacity-40"
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
              className="absolute top-full left-0 right-0 sm:right-auto mt-1 rounded-lg shadow-lg z-50 overflow-hidden max-h-[300px] overflow-y-auto w-full sm:w-64 min-w-0"
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
                    <PreviewableArtwork
                      src={r.image_url}
                      alt={r.name}
                      className="w-6 h-6 rounded-full object-cover flex-shrink-0"
                      interactive="inline"
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

        {activeFiltersSummary.length > 0 ? (
          <div
            className="basis-full w-full flex flex-wrap items-center gap-x-2 gap-y-1 border-t pt-2 mt-1 -mx-4 px-4 text-[10px] leading-snug"
            style={{ borderColor: colors.border, color: colors.muted }}
          >
            <span className="font-semibold uppercase tracking-wide opacity-80 shrink-0">
              Combined filters
            </span>
            <span className="min-w-0">
              {activeFiltersSummary.map((t, i) => (
                <span key={i}>
                  {i > 0 ? " · " : null}
                  {t}
                </span>
              ))}
            </span>
          </div>
        ) : null}

        {/* Stats */}
        <div className="ml-auto text-xs text-right" style={{ color: colors.muted }}>
          {networkScope.mode === "playlist" || networkScope.mode === "custom" ? (
            <span className="block sm:inline">
              Scoped: {formatNetworkScopeLabel(networkScope, playlistNameByKey)}
              {" · "}
            </span>
          ) : null}
          {collabRangeIsActive(collabFilterMin, collabFilterMax) ||
          trackCountMinEffective != null ||
          trackCountMaxEffective != null ||
          networkAdvAppliedCount > 0 ? (
            <>
              <span className="whitespace-nowrap">
                {graphData.nodes.length} visible
                {collabRangeIsActive(collabFilterMin, collabFilterMax) ? (
                  <>
                    {" "}
                    ({formatCollabRangeSummary(collabFilterMin, collabFilterMax)} co-artists)
                  </>
                ) : null}
                {(trackCountMinEffective != null || trackCountMaxEffective != null) && (
                  <>
                    {" "}
                    (
                    {trackCountMinEffective != null ? `≥${trackCountMinEffective}` : "any min"} tracks →{" "}
                    {trackCountMaxEffective != null ? `≤${trackCountMaxEffective}` : "any max"})
                  </>
                )}
                {" · "}
                {graphData.links.length} links
              </span>
              <span className="opacity-70"> — full </span>
            </>
          ) : null}
          {nodes.length} artists &middot; {edges.length} collabs
        </div>
      </div>

      {networkAdvFilterApplied &&
      hasActiveConditions(networkAdvFilterApplied) &&
      networkFilterUsesStreamFields(networkAdvFilterApplied) &&
      networkAdvStreamStatsLoading ? (
        <div
          className="flex items-center gap-2 px-4 py-1.5 border-b text-xs"
          style={{
            borderColor: colors.border,
            backgroundColor: colors.isDark ? "rgba(59,130,246,0.14)" : "rgba(59,130,246,0.1)",
            color: colors.text,
          }}
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden />
          <span>Loading stream stats for advanced filter…</span>
        </div>
      ) : null}

      {networkAdvStreamStatsError &&
      networkAdvFilterApplied &&
      hasActiveConditions(networkAdvFilterApplied) &&
      networkFilterUsesStreamFields(networkAdvFilterApplied) ? (
        <div
          className="flex items-start gap-2 px-4 py-2 border-b text-sm"
          style={{
            borderColor: colors.border,
            backgroundColor: colors.isDark ? "rgba(245,158,11,0.12)" : "rgba(245,158,11,0.15)",
            color: colors.text,
          }}
        >
          <span className="flex-1 min-w-0">{networkAdvStreamStatsError}</span>
          <button
            type="button"
            className="shrink-0 rounded-md p-1 hover:opacity-80"
            style={{ color: colors.muted }}
            aria-label="Dismiss stream stats error"
            onClick={() => setNetworkAdvStreamStatsError(null)}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ) : null}

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

      <FrozenEdgeTrackDetailModal
        open={frozenTooltipTrackModal != null}
        onClose={() => setFrozenTooltipTrackModal(null)}
        isrc={frozenTooltipTrackModal?.isrc ?? null}
        fallbackTitle={frozenTooltipTrackModal?.fallbackTitle ?? ""}
        datasetMode={datasetMode}
        onFocusArtistOnNetwork={focusOnArtist}
      />

      <SharedTracksListModal
        open={sharedTracksListModal != null}
        onClose={() => setSharedTracksListModal(null)}
        title={sharedTracksListModal?.title ?? ""}
        tracks={sharedTracksListModal?.tracks ?? []}
        onTrackOpenDetail={(isrc, displayName) => {
          setSharedTracksListModal(null);
          openFrozenTooltipTrackDetail(isrc, displayName);
        }}
      />

      <SelectionCollabsModal
        open={selectionCollabsModalOpen}
        onClose={() => setSelectionCollabsModalOpen(false)}
        internalEdges={rangeStats.internalEdges}
        nodes={nodes}
        scopeLabel={formatNetworkScopeLabel(networkScope, playlistNameByKey)}
        onNetworkSelectArtist={(artistId) => {
          setSelectedNodeId(null);
          setRangeSelection([artistId]);
          setSelectionCollabsModalOpen(false);
        }}
      />

      <SelectionScopedTracksModal
        open={selectionScopedTracksOpen}
        onClose={() => setSelectionScopedTracksOpen(false)}
        artistIds={rangeSelection}
        playlistKey={playlistKey}
        scopeCacheKey={networkScopeIdentityStr}
        hideNonPrimary={hideNonPrimary}
        scopeLabel={formatNetworkScopeLabel(networkScope, playlistNameByKey)}
        expectedTrackCount={streamTotals.trackCount}
        onTrackRowPrimary={() => {
          setSelectionScopedTracksOpen(false);
          const id = rangeSelection[0];
          if (id) focusOnArtist(id);
        }}
      />

      {/* Selected node info panel */}
      {selectedNodeId && isCrossLabelMode ? (
        <div
          className="border-t px-4 py-3 flex flex-wrap items-center gap-3 shrink-0"
          style={{ borderColor: colors.border, backgroundColor: colors.card }}
        >
          {(() => {
            const node = graphData.nodes.find((n) => n.id === selectedNodeId);
            if (!node) return null;
            return (
              <>
                {node.image_url ? (
                  <PreviewableArtwork
                    src={node.image_url}
                    alt={node.name}
                    width={40}
                    height={40}
                    interactive="inline"
                    className="h-10 w-10 shrink-0 rounded-lg object-cover"
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <div className="font-semibold truncate" style={{ color: colors.text }}>
                    {node.name}
                  </div>
                  <div className="text-xs tabular-nums" style={{ color: colors.muted }}>
                    {formatInt(node.track_count)} active playlist tracks ·{" "}
                    {graphDegreeMap.get(selectedNodeId) ?? 0} shared-track links to other labels
                  </div>
                </div>
                <button
                  type="button"
                  className="rounded-lg px-3 py-1.5 text-xs font-medium shrink-0"
                  style={{ backgroundColor: "var(--sb-accent)", color: "#000" }}
                  onClick={() => void switchCompetitorLabel(selectedNodeId)}
                >
                  Open competitor
                </button>
                <button
                  type="button"
                  className="rounded-lg px-2 py-1.5 text-xs shrink-0"
                  style={{ color: colors.muted }}
                  onClick={() => setSelectedNodeId(null)}
                  aria-label="Close selection"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </>
            );
          })()}
        </div>
      ) : null}
      {selectedNodeId && !isCrossLabelMode ? (
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
      ) : null}

      {rangeSelection.length > 0 && (
        <SelectionStatsPanel
          artistCount={rangeSelection.length}
          playlistScopeLabel={networkExportScopeLabel}
          internalEdgeCount={rangeStats.internalEdges.length}
          weightSum={rangeStats.weightSum}
          uniqueCollabTracks={rangeStats.unionIsrcs.length}
          streamTotals={streamTotals}
          colors={colors}
          onOpenCollabsList={() => setSelectionCollabsModalOpen(true)}
          onOpenScopedTracks={() => setSelectionScopedTracksOpen(true)}
          onClear={() => {
            setSelectionCollabsModalOpen(false);
            setSelectionScopedTracksOpen(false);
            setRangeSelection([]);
          }}
        />
      )}

      {/* Graph + optional table */}
      <div className="flex flex-1 flex-col min-h-0 min-w-0">
        <div
          ref={containerRef}
          className="relative min-h-[220px] min-w-0 flex-1 touch-none overflow-hidden"
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
              backgroundColor: accentRgba(colors.accent, colors.isDark ? 0.06 : 0.08),
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
          nodeLabel={() => ""}
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
          onLinkClick={handleLinkClick}
          onBackgroundClick={handleBackgroundClick}
          linkHoverPrecision={6}
          enableNodeDrag={true}
          enablePanInteraction={graphTouchPanZoomFilter}
          // Engine
          d3AlphaDecay={0.02}
          d3VelocityDecay={0.3}
          warmupTicks={80}
          cooldownTime={3000}
          onEngineStop={onEngineStop}
          minZoom={graphMinZoom}
          maxZoom={20}
        />

        {/* Tooltip overlay — link tooltips can be pinned (mouse click / touch long-press) like home XY chart */}
        {tooltipContent &&
          (pinnedLink
            ? pinnedTooltipPos != null
            : tooltipPos != null && (hoveredNode != null || hoveredLink != null)) && (
            <div
              className={`absolute z-50 max-w-[320px] ${pinnedLink ? "pointer-events-auto" : "pointer-events-none"}`}
              style={{
                left:
                  (pinnedLink ? pinnedTooltipPos!.x : tooltipPos!.x) + 14,
                top: (pinnedLink ? pinnedTooltipPos!.y : tooltipPos!.y) + 14,
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
            >
              <ViewportAwareTooltip>
                {pinnedLink ? (
                  tooltipContent
                ) : (
                  <div
                    className="rounded-lg px-3 py-2 shadow-lg backdrop-blur-md max-w-[280px]"
                    style={{
                      backgroundColor: colors.card,
                      border: `1px solid ${colors.border}`,
                    }}
                  >
                    {tooltipContent}
                  </div>
                )}
              </ViewportAwareTooltip>
            </div>
          )}
        </div>
        {tableView ? (
          <NetworkArtistsTable
            nodes={graphData.nodes}
            trackCollabFilterMap={trackCollabFilterMap}
            graphDegreeMap={graphDegreeMap}
            collabCountBasis={collabCountBasis}
            colors={colors}
            sortKey={tableSort.key}
            sortDir={tableSort.dir}
            onSortColumn={cycleTableSortColumn}
            onRowActivate={focusOnArtist}
            streamStatsById={tableStreamStats}
            streamsLoading={tableStreamStatsLoading}
            streamsError={tableStreamStatsError}
          />
        ) : null}
      </div>
    </div>
  );
}
