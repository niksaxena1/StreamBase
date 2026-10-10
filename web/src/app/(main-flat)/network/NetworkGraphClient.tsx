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
import type { ForceGraphMethods, ForceGraphProps } from "react-force-graph-2d";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { UserRound } from "lucide-react";
import { fetchApiJson } from "@/lib/api";
import { dispatchCompetitorLabelChange } from "@/lib/competitorAccentEvents";
import type { DatasetMode } from "@/lib/datasetMode";
import type { NetworkGraphMode } from "@/lib/network/loadNetworkPage";
import type { NetworkArtistStreamExportRow } from "@/lib/networkViewXlsx";
import { ChartCsvDownloadButton } from "@/components/charts/ChartCsvDownloadButton";
import { ViewportAwareTooltip } from "@/components/charts/ViewportAwareTooltip";
import { useThemeColors } from "@/components/charts/useThemeColors";
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
import { NetworkNodeTooltipContent } from "./NetworkNodeTooltip";
import { NetworkHelpModal } from "./NetworkHelpModal";
import {
  NetworkArtistSearch,
  NetworkCoArtistFilter,
  NetworkScopeMenu,
  NetworkToolbarActions,
  NetworkToolbarBanners,
  NetworkToolbarStats,
  NetworkTrackCountFilter,
  buildNetworkScopeMenuOptions,
} from "./NetworkToolbar";
import {
  SelectionCollabsModal,
  SelectionScopedTracksModal,
  SelectionStatsPanel,
} from "./NetworkSelectionPanels";
import { CrossLabelSelectedPanel, SelectedArtistPanel } from "./NetworkSelectedArtistPanel";
import {
  CAMERA_SAVE_MS,
  LS_NETWORK_CAMERA,
  LS_NETWORK_SHOW_GRID,
  readNetworkShowGridFromStorage,
  NETWORK_LONG_PRESS_MS,
  NETWORK_LONG_PRESS_MOVE_PX,
  SCOPE_CATALOG,
  SCOPE_CUSTOM,
} from "./networkGraphConstants";
import { drawNetworkBackgroundGrid, pickNetworkNodeAtClientPos } from "./networkGraphCanvas";
import {
  accentRgba,
  buildAdjacency,
  collaborationLinkKey,
  computeRangeSelectionStats,
  isTypingTarget,
  linkEndpointId,
  trackScopedCoartistCount,
  type FGLinkObj,
  type FGNodeObj,
} from "./networkGraphPure";
import type { CollabCountBasis, NetworkTableSortKey, NetworkUrlPatch } from "./networkGraphTypes";
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
  readNetworkToggles,
} from "./networkGraphUrl";
import {
  ALL_CATALOG_PLAYLIST_KEY,
  appendNetworkScopeToSearchParams,
  DEFAULT_NETWORK_SCOPE,
  formatNetworkScopeLabel,
  networkScopeIdentity,
  parseNetworkScope,
} from "./networkScope";
import type { GraphNode, GraphEdge, NetworkPlaylistOption, SharedTrack } from "./networkTypes";
import { runNetworkViewXlsxExport } from "./networkViewExport";
import { useNetworkGraphPainters } from "./useNetworkGraphPainters";
import { useNetworkNodeFilters } from "./useNetworkNodeFilters";
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

  const playlistScopeOptions = useMemo(
    () => buildNetworkScopeMenuOptions(scopePlaylists, networkScope, playlistNameByKey, catalogScopeLabel),
    [scopePlaylists, networkScope, playlistNameByKey, catalogScopeLabel],
  );

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

  const {
    minTrackCount,
    maxTrackCount,
    graphDegreeMap,
    trackCollabFilterMap,
    trackCountMinEffective,
    trackCountMaxEffective,
    filteredVisibleNodeIds,
  } = useNetworkNodeFilters({
    nodes,
    edges,
    collabCountBasis,
    collabFilterMin,
    collabFilterMax,
    trackCountMin,
    trackCountMax,
  });

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
      return pickNetworkNodeAtClientPos(fg, host, clientX, clientY, {
        width: dimensions.width,
        height: dimensions.height,
        nodes: graphData.nodes as FGNodeObj[],
        scaleByTracks,
        minTrackCount,
        maxTrackCount,
      });
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
      await runNetworkViewXlsxExport({
        networkExportScopeLabel,
        hideNonPrimary,
        collabFilterExportLabel,
        collabCountBasisLabel,
        graphData: { nodes: graphData.nodes, links: graphData.links },
        nodes,
        edges,
        trackCollabFilterMap,
        playlistKey,
        pathname,
        searchParams,
        setXlsxExportPhase,
        setXlsxExportAlert,
      });
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
    (patch: NetworkUrlPatch) => {
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

  const rangeStats = useMemo(() => computeRangeSelectionStats(edges, rangeSelection), [edges, rangeSelection]);

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

  /* -------- Node / link rendering -------- */

  const { nodeVal, nodeCanvasObject, nodePointerAreaPaint, linkWidth, linkColor } = useNetworkGraphPainters({
    scaleByTracks,
    showImages,
    minTrackCount,
    maxTrackCount,
    selectedNodeId,
    hoveredNode,
    hoveredLink,
    pinnedLink,
    rangeSet,
    isHighlighted,
    isLinkHighlighted,
    colors,
  });

  /** World-space grid (pans/zooms with the graph) for spatial reference while navigating. */
  const onRenderFramePre = useCallback(
    (ctx: CanvasRenderingContext2D, globalScale: number) => {
      const fg = fgRef.current;
      const w = dimensions.width;
      const h = dimensions.height;
      if (!fg || w < 8 || h < 8 || !Number.isFinite(globalScale) || globalScale < 0.001) return;
      if (!showBackgroundGrid) return;

      drawNetworkBackgroundGrid(ctx, globalScale, fg, w, h, colors.isDark);
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
      return (
        <NetworkNodeTooltipContent
          node={hoveredNode as FGNode}
          trackCollabFilterMap={trackCollabFilterMap}
          graphDegreeMap={graphDegreeMap}
          collabCountBasis={collabCountBasis}
          hideNonPrimary={hideNonPrimary}
          colors={colors}
        />
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

      <NetworkHelpModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} colors={colors} />

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
          <NetworkScopeMenu
            scopeMenuValue={scopeMenuValue}
            playlistScopeOptions={playlistScopeOptions}
            catalogScopeLabel={catalogScopeLabel}
            pushNetworkUrl={pushNetworkUrl}
            setCustomScopeModalOpen={setCustomScopeModalOpen}
          />
        )}

        {!isCrossLabelMode ? (
          <NetworkCoArtistFilter
            colors={colors}
            collabMinDraft={collabMinDraft}
            setCollabMinDraft={setCollabMinDraft}
            collabMaxDraft={collabMaxDraft}
            setCollabMaxDraft={setCollabMaxDraft}
            commitCollabRange={commitCollabRange}
            collabCountBasis={collabCountBasis}
            setCollabCountBasis={setCollabCountBasis}
            pushNetworkUrl={pushNetworkUrl}
          />
        ) : null}

        <NetworkTrackCountFilter
          colors={colors}
          isCrossLabelMode={isCrossLabelMode}
          trackCountMinDraft={trackCountMinDraft}
          setTrackCountMinDraft={setTrackCountMinDraft}
          setTrackCountMin={setTrackCountMin}
          trackCountMaxDraft={trackCountMaxDraft}
          setTrackCountMaxDraft={setTrackCountMaxDraft}
          setTrackCountMax={setTrackCountMax}
          pushNetworkUrl={pushNetworkUrl}
        />

        {/* Icon toggles before search so narrow viewports don’t place Scale/Images on a row beside the search field */}
        <NetworkToolbarActions
          colors={colors}
          isCrossLabelMode={isCrossLabelMode}
          isCompetitorDataset={isCompetitorDataset}
          scaleByTracks={scaleByTracks}
          showImages={showImages}
          boxSelectArmed={boxSelectArmed}
          setBoxSelectArmed={setBoxSelectArmed}
          hideNonPrimary={hideNonPrimary}
          tableView={tableView}
          pushNetworkUrl={pushNetworkUrl}
          networkAdvAppliedCount={networkAdvAppliedCount}
          setNetworkAdvModalOpen={setNetworkAdvModalOpen}
          xlsxExportPhase={xlsxExportPhase}
          xlsxExporting={xlsxExporting}
          handleExportViewXlsx={handleExportViewXlsx}
          setShortcutsOpen={setShortcutsOpen}
          handleReset={handleReset}
        />

        <div className="w-px h-5 max-sm:hidden shrink-0" style={{ backgroundColor: colors.border }} />

        {/* Search */}
        <NetworkArtistSearch
          colors={colors}
          searchInputRef={searchInputRef}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          searchOpen={searchOpen}
          setSearchOpen={setSearchOpen}
          searchResults={searchResults}
          focusOnArtist={focusOnArtist}
        />

        <NetworkToolbarStats
          colors={colors}
          activeFiltersSummary={activeFiltersSummary}
          networkScope={networkScope}
          playlistNameByKey={playlistNameByKey}
          collabFilterMin={collabFilterMin}
          collabFilterMax={collabFilterMax}
          trackCountMinEffective={trackCountMinEffective}
          trackCountMaxEffective={trackCountMaxEffective}
          networkAdvAppliedCount={networkAdvAppliedCount}
          graphData={graphData}
          nodes={nodes}
          edges={edges}
        />
      </div>

      <NetworkToolbarBanners
        colors={colors}
        networkAdvFilterApplied={networkAdvFilterApplied}
        networkAdvStreamStatsLoading={networkAdvStreamStatsLoading}
        networkAdvStreamStatsError={networkAdvStreamStatsError}
        setNetworkAdvStreamStatsError={setNetworkAdvStreamStatsError}
        xlsxExportAlert={xlsxExportAlert}
        setXlsxExportAlert={setXlsxExportAlert}
      />

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
        <CrossLabelSelectedPanel
          selectedNodeId={selectedNodeId}
          nodes={graphData.nodes}
          graphDegreeMap={graphDegreeMap}
          colors={colors}
          switchCompetitorLabel={switchCompetitorLabel}
          setSelectedNodeId={setSelectedNodeId}
        />
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
