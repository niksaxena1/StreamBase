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
import { useRouter } from "next/navigation";
import { Search, RotateCcw, ImageIcon, Scaling, UserRound, ListMusic, Disc3 } from "lucide-react";
import { formatDateISO, formatInt } from "@/lib/format";
import { slugifyForFilename, todayIsoDate } from "@/lib/csv";
import { ChartCsvDownloadButton } from "@/components/charts/ChartCsvDownloadButton";
import { useThemeColors } from "@/components/charts/useThemeColors";
import { MenuSelect, type MenuSelectOption } from "@/components/ui/MenuSelect";
import { Modal } from "@/components/ui/Modal";
import { GlassTable, TableRow, TableCell, EmptyState } from "@/components/ui/GlassTable";
import {
  ArtistDistroTracksModal,
  type ArtistDistroTrackRow,
  type DistroPlaylist,
} from "@/components/catalog/ArtistDistroTracksModal";
import type { GraphNode, GraphEdge, SharedTrack, NetworkPlaylistOption } from "./page";

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

function networkPageHref(playlistKey: string | null, hideNonPrimary: boolean) {
  const p = new URLSearchParams();
  if (playlistKey) p.set("playlist", playlistKey);
  if (hideNonPrimary) p.set("hide_non_primary", "1");
  const s = p.toString();
  return s ? `/network?${s}` : "/network";
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
  const colors = useThemeColors();
  const fgRef = useRef<ForceGraphMethods<FGNode, FGLink> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Controls
  const [scaleByTracks, setScaleByTracks] = useState(true);
  const [showImages, setShowImages] = useState(true);
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

  // Collaboration count per node (for tooltip)
  const collabCountMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of edges) {
      map.set(e.source, (map.get(e.source) ?? 0) + 1);
      map.set(e.target, (map.get(e.target) ?? 0) + 1);
    }
    return map;
  }, [edges]);

  // Graph data — react-force-graph mutates objects so we keep stable refs.
  const graphData = useMemo(() => {
    return {
      nodes: nodes.map((n) => ({ ...n })),
      links: edges.map((e) => ({ ...e })),
    };
  }, [nodes, edges]);

  const nodeIdKey = useMemo(
    () =>
      [...nodes]
        .map((n) => n.id)
        .sort()
        .join("\0"),
    [nodes],
  );

  const rangeSet = useMemo(() => new Set(rangeSelection), [rangeSelection]);

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
    return nodes
      .filter((n) => n.name.toLowerCase().includes(q))
      .slice(0, 12);
  }, [nodes, searchQuery]);

  // Is a node highlighted?
  const isHighlighted = useCallback(
    (nodeId: string) => {
      if (rangeSet.size > 0) return rangeSet.has(nodeId);
      if (!selectedNodeId) return true;
      if (nodeId === selectedNodeId) return true;
      return neighbors.get(selectedNodeId)?.has(nodeId) ?? false;
    },
    [rangeSet, selectedNodeId, neighbors],
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

  const onBoxPointerDownCapture = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!e.altKey || e.button !== 0) return;
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
  }, []);

  const onBoxPointerMoveCapture = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const d = selectDragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
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
  }, []);

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
    },
    [graphData.nodes],
  );

  const onBoxPointerUpCapture = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      finalizeBoxSelect(e);
    },
    [finalizeBoxSelect],
  );

  const onBoxPointerCancelCapture = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
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
    [],
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
    setSelectedNodeId(null);
    setRangeSelection([]);
    setSearchQuery("");
    fgRef.current?.zoomToFit(600, 40);
  }, []);

  /* -------- Initial zoom-to-fit -------- */

  const hasZoomed = useRef(false);
  useEffect(() => {
    hasZoomed.current = false;
    setBoxRect(null);
    setRangeSelection((prev) => prev.filter((id) => nodes.some((n) => n.id === id)));

    const prevSel = selectedNodeIdRef.current;
    const keepSel = Boolean(prevSel && nodes.some((n) => n.id === prevSel));
    refocusSingleAfterGraphReloadRef.current = keepSel;
    setSelectedNodeId(keepSel ? prevSel : null);
  }, [playlistKey, hideNonPrimary, nodeIdKey]);

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

    hasZoomed.current = true;
    refocusSingleAfterGraphReloadRef.current = false;
    fgRef.current?.zoomToFit(400, 40);
  }, [graphData.nodes]);

  /* -------- Tooltip content -------- */

  const tooltipContent = useMemo(() => {
    if (hoveredNode) {
      const n = hoveredNode;
      const collabs = collabCountMap.get(n.id as string) ?? 0;
      return (
        <div className="space-y-1">
          <div className="font-semibold text-sm" style={{ color: colors.accent }}>
            {n.name}
          </div>
          <div className="text-xs" style={{ color: colors.muted }}>
            {n.track_count} track{n.track_count !== 1 ? "s" : ""} &middot;{" "}
            {collabs} collaborator{collabs !== 1 ? "s" : ""}
          </div>
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
  }, [hoveredNode, hoveredLink, collabCountMap, colors]);

  /* -------- Render -------- */

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
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
            router.push(networkPageHref(v || null, hideNonPrimary));
          }}
          ariaLabel="Scope graph to playlist"
          placeholder="All catalog tracks"
          matchTriggerWidth={false}
          className="min-w-[10rem] max-w-[min(100vw-8rem,17rem)]"
          menuClassName="max-h-80 min-w-[min(100vw-2rem,17rem)] overflow-y-auto"
        />

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
              type="text"
              placeholder="Search artist..."
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

        {/* Toggle: Scale by tracks */}
        <ToggleButton
          active={scaleByTracks}
          onClick={() => setScaleByTracks((v) => !v)}
          icon={<Scaling size={14} />}
          label="Scale by tracks"
          colors={colors}
        />

        {/* Toggle: Show images */}
        <ToggleButton
          active={showImages}
          onClick={() => setShowImages((v) => !v)}
          icon={<ImageIcon size={14} />}
          label="Show images"
          colors={colors}
        />

        <ToggleButton
          active={hideNonPrimary}
          onClick={() =>
            router.push(networkPageHref(playlistKey, !hideNonPrimary))
          }
          icon={<UserRound size={14} />}
          label="Hide non-primary"
          colors={colors}
        />

        {/* Divider */}
        <div className="w-px h-5" style={{ backgroundColor: colors.border }} />

        {/* Reset */}
        <button
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-colors"
          style={{
            color: colors.muted,
            backgroundColor: colors.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
          }}
          onClick={handleReset}
        >
          <RotateCcw size={13} />
          Reset
        </button>

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
          {nodes.length} artists &middot; {edges.length} collaborations
          <span className="hidden xl:inline">
            {" "}
            &middot; Alt+drag box &middot; Ctrl+click distro
          </span>
        </div>
      </div>

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
          nodes={nodes}
          edges={edges}
          neighbors={neighbors}
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
  release_date: string | null;
  totalStreams: number | null;
  dailyStreams: number | null;
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
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
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
        <ChartCsvDownloadButton
          rows={csvRows as unknown as Array<Record<string, unknown>>}
          filename={`network-collabs-${slugifyForFilename(scopeLabel)}-${todayIsoDate()}.csv`}
          title="Download CSV"
          sortForExport={false}
          headers={["collaboration", "track", "isrc", "release_date", "total_streams", "daily_streams"]}
          disabled={rows.length === 0}
        />
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
  label,
  colors,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  colors: ReturnType<typeof useThemeColors>;
}) {
  return (
    <button
      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-colors"
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
      {label}
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
  colors,
  onClose,
  onFocusArtist,
}: {
  nodeId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  neighbors: Map<string, Set<string>>;
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
            {node.track_count} tracks &middot; {neighborNodes.length} collaborators &middot;{" "}
            {totalSharedTracks} shared tracks
          </span>
          <button
            className="ml-auto text-xs px-2 py-0.5 rounded flex-shrink-0"
            style={{ color: colors.muted }}
            onClick={onClose}
          >
            &times;
          </button>
        </div>

        {/* Collaborators list */}
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
