"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";
import type {
  ForceGraphMethods,
  NodeObject,
  LinkObject,
} from "react-force-graph-2d";
import { Search, RotateCcw, ImageIcon, Scaling } from "lucide-react";
import { useThemeColors } from "@/components/charts/useThemeColors";
import type { GraphNode, GraphEdge, SharedTrack } from "./page";

// Force-graph uses Canvas/WebGL — must skip SSR.
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
});

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type FGNode = NodeObject<GraphNode>;
type FGLink = LinkObject<GraphNode, GraphEdge>;

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
}

export function ArtistChainsClient({ nodes, edges }: Props) {
  const colors = useThemeColors();
  const fgRef = useRef<ForceGraphMethods<FGNode, FGLink> | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);

  // Controls
  const [scaleByTracks, setScaleByTracks] = useState(true);
  const [showImages, setShowImages] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  // Interaction state
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<FGNode | null>(null);
  const [hoveredLink, setHoveredLink] = useState<FGLink | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

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
      if (!selectedNodeId) return true;
      if (nodeId === selectedNodeId) return true;
      return neighbors.get(selectedNodeId)?.has(nodeId) ?? false;
    },
    [selectedNodeId, neighbors],
  );

  // Is a link highlighted?
  const isLinkHighlighted = useCallback(
    (link: FGLink) => {
      if (!selectedNodeId) return true;
      const srcId = typeof link.source === "object" ? (link.source as FGNode).id : link.source;
      const tgtId = typeof link.target === "object" ? (link.target as FGNode).id : link.target;
      return srcId === selectedNodeId || tgtId === selectedNodeId;
    },
    [selectedNodeId],
  );

  /* -------- Node rendering -------- */

  const nodeVal = useCallback(
    (node: FGNode) => {
      if (!scaleByTracks) return 2;
      return scaleLinear(node.track_count ?? 1, minTrackCount, maxTrackCount, 1, 12);
    },
    [scaleByTracks, minTrackCount, maxTrackCount],
  );

  const nodeCanvasObject = useCallback(
    (node: FGNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const id = node.id as string;
      const highlighted = isHighlighted(id);
      const alpha = highlighted ? 1 : 0.12;

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
        ctx.fillStyle = id === selectedNodeId ? colors.accent : colors.accentStroke;
        ctx.fill();

        // Subtle glow for selected
        if (id === selectedNodeId) {
          ctx.shadowColor = colors.accent;
          ctx.shadowBlur = 12;
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }

      // Label (show when zoomed in or when highlighted)
      const showLabel = globalScale > 1.8 || id === selectedNodeId || id === (hoveredNode?.id as string);
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
    ],
  );

  // Hit area for pointer
  const nodePointerAreaPaint = useCallback(
    (node: FGNode, color: string, ctx: CanvasRenderingContext2D) => {
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
    (link: FGLink) => {
      const w = (link as unknown as GraphEdge).weight ?? 1;
      return Math.min(w * 0.8, 6);
    },
    [],
  );

  const linkColor = useCallback(
    (link: FGLink) => {
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

  /* -------- Interactions -------- */

  const handleNodeClick = useCallback(
    (node: FGNode) => {
      const id = node.id as string;
      if (selectedNodeId === id) {
        // Deselect
        setSelectedNodeId(null);
      } else {
        setSelectedNodeId(id);
        // Center on the node
        fgRef.current?.centerAt(node.x, node.y, 600);
        fgRef.current?.zoom(3, 600);
      }
    },
    [selectedNodeId],
  );

  const handleBackgroundClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  const handleNodeHover = useCallback(
    (node: FGNode | null, _prev: FGNode | null) => {
      setHoveredNode(node);
      if (!node) {
        setTooltipPos(null);
      }
    },
    [],
  );

  const handleLinkHover = useCallback(
    (link: FGLink | null, _prev: FGLink | null) => {
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
      fgRef.current?.centerAt(node.x, node.y, 800);
      fgRef.current?.zoom(4, 800);
    },
    [graphData.nodes],
  );

  /* -------- Reset -------- */

  const handleReset = useCallback(() => {
    setSelectedNodeId(null);
    setSearchQuery("");
    fgRef.current?.zoomToFit(600, 40);
  }, []);

  /* -------- Initial zoom-to-fit -------- */

  const hasZoomed = useRef(false);
  const onEngineStop = useCallback(() => {
    if (!hasZoomed.current) {
      hasZoomed.current = true;
      fgRef.current?.zoomToFit(400, 40);
    }
  }, []);

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
        ? (hoveredLink.source as FGNode)
        : null;
      const tgtNode = typeof hoveredLink.target === "object"
        ? (hoveredLink.target as FGNode)
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
        <div className="ml-auto text-xs" style={{ color: colors.muted }}>
          {nodes.length} artists &middot; {edges.length} collaborations
        </div>
      </div>

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

      {/* Graph container */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden">
        <ForceGraph2D
          ref={fgRef as React.MutableRefObject<ForceGraphMethods<FGNode, FGLink> | undefined>}
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
