"use client";

import { useMemo, useState } from "react";

import { formatInt } from "@/lib/format";
import type { ThemeColors } from "@/components/charts/useThemeColors";
import type { TestSankeyRow } from "./testTypes";

type SankeyNodeKind = "label" | "playlist" | "track";

type SankeyNode = {
  id: string;
  label: string;
  kind: SankeyNodeKind;
  accent: string;
};

type SankeyLink = {
  source: string;
  target: string;
  value: number;
  daily: number | null;
  total: number | null;
};

type PositionedNode = SankeyNode & {
  x: number;
  y: number;
  width: number;
  height: number;
  value: number;
};

type PositionedLink = SankeyLink & {
  sourceNode: PositionedNode;
  targetNode: PositionedNode;
  width: number;
};

const KIND_LABEL: Record<SankeyNodeKind, string> = {
  label: "Collector / type",
  playlist: "Playlists",
  track: "Tracks",
};

const TRACK_COLORS = ["#c7f33c", "#60a5fa", "#34d399", "#fbbf24", "#818cf8", "#fb7185", "#2dd4bf", "#94a3b8"];

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
}

function buildRealGraph(rows: TestSankeyRow[], colors: ThemeColors) {
  const nodes = new Map<string, SankeyNode>();
  const links = new Map<string, SankeyLink>();
  const usableRows = rows.filter((row) => row.value > 0);
  const trackTotals = new Map<string, number>();
  for (const row of usableRows) trackTotals.set(row.isrc, (trackTotals.get(row.isrc) ?? 0) + row.value);
  const topTrackIds = new Set(
    [...trackTotals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([isrc]) => isrc),
  );

  function addNode(node: SankeyNode) {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
  }

  function addLink(next: SankeyLink) {
    const key = `${next.source}-${next.target}`;
    const existing = links.get(key);
    if (!existing) {
      links.set(key, next);
      return;
    }
    existing.value += next.value;
    existing.daily = existing.daily != null || next.daily != null ? (existing.daily ?? 0) + (next.daily ?? 0) : null;
    existing.total = existing.total != null || next.total != null ? (existing.total ?? 0) + (next.total ?? 0) : null;
  }

  for (const row of usableRows) {
    const groupId = `group-${slug(row.group_key || row.group_name)}`;
    const playlistId = `playlist-${slug(row.playlist_key)}`;
    const trackId = topTrackIds.has(row.isrc) ? `track-${slug(row.isrc)}` : "track-other";
    const trackLabel = topTrackIds.has(row.isrc) ? row.track_name : "Other tracks";
    const trackColor = topTrackIds.has(row.isrc)
      ? TRACK_COLORS[Math.abs(row.isrc.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0)) % TRACK_COLORS.length]
      : "#94a3b8";

    addNode({ id: groupId, label: row.group_name, kind: "label", accent: colors.accent });
    addNode({ id: playlistId, label: row.playlist_name, kind: "playlist", accent: colors.positive });
    addNode({ id: trackId, label: trackLabel, kind: "track", accent: trackColor });
    addLink({ source: groupId, target: playlistId, value: row.value, daily: row.daily, total: row.total });
    addLink({ source: playlistId, target: trackId, value: row.value, daily: row.daily, total: row.total });
  }

  return { nodes: [...nodes.values()], links: [...links.values()] };
}

function getNodeValue(nodeId: string, links: SankeyLink[]) {
  let incoming = 0;
  let outgoing = 0;
  for (const link of links) {
    if (link.target === nodeId) incoming += link.value;
    if (link.source === nodeId) outgoing += link.value;
  }
  return Math.max(incoming, outgoing);
}

function pathBetween(link: PositionedLink) {
  const x0 = link.sourceNode.x + link.sourceNode.width;
  const x1 = link.targetNode.x;
  const y0 = link.sourceNode.y + link.sourceNode.height / 2;
  const y1 = link.targetNode.y + link.targetNode.height / 2;
  const c = Math.max(80, (x1 - x0) * 0.55);
  return `M ${x0} ${y0} C ${x0 + c} ${y0}, ${x1 - c} ${y1}, ${x1} ${y1}`;
}

function buildLayout(nodes: SankeyNode[], links: SankeyLink[]) {
  const width = 960;
  const height = 430;
  if (nodes.length === 0 || links.length === 0) return { width, height, nodes: [] as PositionedNode[], links: [] as PositionedLink[] };
  const nodeWidth = 138;
  const minNodeHeight = 30;
  const maxNodeHeight = 74;
  const columns: SankeyNodeKind[] = ["label", "playlist", "track"];
  const xByKind: Record<SankeyNodeKind, number> = {
    label: 28,
    playlist: 410,
    track: 792,
  };
  const maxValue = Math.max(...nodes.map((node) => getNodeValue(node.id, links)));
  const positioned: PositionedNode[] = [];

  for (const kind of columns) {
    const group = nodes.filter((node) => node.kind === kind);
    const heights = group.map((node) => {
      const value = getNodeValue(node.id, links);
      const scaled = minNodeHeight + (value / maxValue) * (maxNodeHeight - minNodeHeight);
      return Math.round(scaled);
    });
    const totalNodeHeight = heights.reduce((sum, item) => sum + item, 0);
    const gap = group.length > 1 ? Math.max(16, (height - 60 - totalNodeHeight) / (group.length - 1)) : 0;
    let y = (height - totalNodeHeight - gap * Math.max(0, group.length - 1)) / 2;

    for (let i = 0; i < group.length; i++) {
      const node = group[i];
      const nodeHeight = heights[i];
      positioned.push({
        ...node,
        x: xByKind[kind],
        y,
        width: nodeWidth,
        height: nodeHeight,
        value: getNodeValue(node.id, links),
      });
      y += nodeHeight + gap;
    }
  }

  const byId = new Map(positioned.map((node) => [node.id, node]));
  const maxLink = Math.max(...links.map((link) => link.value));
  const positionedLinks = links
    .map((link): PositionedLink | null => {
      const sourceNode = byId.get(link.source);
      const targetNode = byId.get(link.target);
      if (!sourceNode || !targetNode) return null;
      return {
        ...link,
        sourceNode,
        targetNode,
        width: Math.max(4, (link.value / maxLink) * 28),
      };
    })
    .filter((link): link is PositionedLink => link != null);

  return { width, height, nodes: positioned, links: positionedLinks };
}

export function SankeyFlowExperiment({
  colors,
  rows,
  asOfDate,
}: {
  colors: ThemeColors;
  rows: TestSankeyRow[];
  asOfDate: string | null;
}) {
  const [activeLinkKey, setActiveLinkKey] = useState<string | null>(null);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const graph = useMemo(() => buildRealGraph(rows, colors), [colors, rows]);
  const layout = useMemo(() => buildLayout(graph.nodes, graph.links), [graph]);
  const totalStreams = useMemo(
    () => graph.links.filter((link) => link.source.startsWith("group-")).reduce((sum, link) => sum + link.value, 0),
    [graph.links],
  );
  const topFlows = useMemo(
    () => graph.links.filter((link) => link.source.startsWith("playlist-")).sort((a, b) => b.value - a.value).slice(0, 8),
    [graph.links],
  );
  const nodesById = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);

  const activeLink = activeLinkKey
    ? layout.links.find((link) => `${link.source}-${link.target}` === activeLinkKey) ?? null
    : null;

  return (
    <div className="p-3">
      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm" style={{ color: "var(--sb-muted)" }}>
          No playlist track rows returned for the latest date.
        </p>
      ) : null}
      <div className="mb-4 grid gap-3 text-xs sm:grid-cols-3" style={{ color: "var(--sb-muted)" }}>
        <div>
          <div className="font-medium uppercase tracking-wide opacity-70">Scope</div>
          <div className="mt-1 text-sm font-semibold" style={{ color: "var(--sb-text)" }}>
            Catalog grouping flow
          </div>
        </div>
        <div>
          <div className="font-medium uppercase tracking-wide opacity-70">Weighted by</div>
          <div className="mt-1 text-sm font-semibold tabular-nums" style={{ color: "var(--sb-text)" }}>
            {formatInt(totalStreams)} latest daily streams
          </div>
        </div>
        <div>
          <div className="font-medium uppercase tracking-wide opacity-70">As of</div>
          <div className="mt-1 text-sm font-semibold" style={{ color: "var(--sb-text)" }}>
            {asOfDate ?? "latest available"}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border" style={{ borderColor: colors.border }}>
        <svg
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          className="min-h-[320px] min-w-[760px] w-full"
          role="img"
          aria-label="Mock distribution from labels through organizing playlists into tracks"
        >
          <defs>
            <filter id="sankey-flow-shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="7" stdDeviation="9" floodColor={colors.isDark ? "#000000" : "#475569"} floodOpacity="0.16" />
            </filter>
          </defs>

          {(["label", "playlist", "track"] as const).map((kind) => (
            <text key={kind} x={kind === "label" ? 28 : kind === "playlist" ? 410 : 792} y={24} fill={colors.muted} fontSize={12} fontWeight={700}>
              {KIND_LABEL[kind]}
            </text>
          ))}

          <g fill="none">
            {layout.links.map((link) => {
              const key = `${link.source}-${link.target}`;
              const isActive =
                activeLinkKey === key || activeNodeId === link.source || activeNodeId === link.target || (!activeLinkKey && !activeNodeId);
              return (
                <path
                  key={key}
                  d={pathBetween(link)}
                  stroke={link.sourceNode.accent}
                  strokeWidth={link.width}
                  strokeLinecap="round"
                  opacity={isActive ? 0.42 : 0.08}
                  className="transition-opacity duration-150"
                  onMouseEnter={() => setActiveLinkKey(key)}
                  onMouseLeave={() => setActiveLinkKey(null)}
                >
                  <title>
                    {link.sourceNode.label} to {link.targetNode.label}: {formatInt(link.value)} latest daily streams
                  </title>
                </path>
              );
            })}
          </g>

          {layout.nodes.map((node) => {
            const isActive =
              activeNodeId === node.id ||
              layout.links.some(
                (link) =>
                  `${link.source}-${link.target}` === activeLinkKey && (link.source === node.id || link.target === node.id),
              ) ||
              (!activeNodeId && !activeLinkKey);
            return (
              <g
                key={node.id}
                filter={isActive ? "url(#sankey-flow-shadow)" : undefined}
                opacity={isActive ? 1 : 0.42}
                className="transition-opacity duration-150"
                onMouseEnter={() => setActiveNodeId(node.id)}
                onMouseLeave={() => setActiveNodeId(null)}
              >
                <rect x={node.x} y={node.y} width={node.width} height={node.height} rx={7} fill={colors.card} stroke={node.accent} strokeOpacity={0.72} />
                <rect x={node.x} y={node.y} width={5} height={node.height} rx={3} fill={node.accent} />
                <text x={node.x + 14} y={node.y + 18} fill={colors.text} fontSize={12} fontWeight={700}>
                  {node.label}
                </text>
                <text x={node.x + 14} y={node.y + 36} fill={colors.muted} fontSize={11}>
                  {formatInt(node.value)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_260px]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-left text-xs">
            <caption className="sr-only">Top mock Sankey flows by stream count</caption>
            <thead style={{ color: "var(--sb-muted)" }}>
              <tr className="border-b" style={{ borderColor: colors.border }}>
                <th className="py-2 pr-3 font-medium">From</th>
                <th className="py-2 pr-3 font-medium">To</th>
                <th className="py-2 pr-3 text-right font-medium">Daily</th>
                <th className="py-2 pl-3 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {topFlows.map((flow) => {
                const source = nodesById.get(flow.source);
                const target = nodesById.get(flow.target);
                return (
                  <tr key={`${flow.source}-${flow.target}`} className="border-b last:border-b-0" style={{ borderColor: colors.border }}>
                    <td className="py-2 pr-3 font-medium" style={{ color: "var(--sb-text)" }}>
                      {source?.label ?? flow.source}
                    </td>
                    <td className="py-2 pr-3" style={{ color: "var(--sb-muted)" }}>
                      {target?.label ?? flow.target}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums" style={{ color: "var(--sb-text)" }}>
                      {formatInt(flow.value)}
                    </td>
                    <td className="py-2 pl-3 text-right tabular-nums" style={{ color: "var(--sb-muted)" }}>
                      {flow.total != null ? formatInt(flow.total) : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border p-3 text-xs" style={{ borderColor: colors.border, color: "var(--sb-muted)" }}>
          <div className="font-medium uppercase tracking-wide opacity-70">Hover readout</div>
          {activeLink ? (
            <div className="mt-2 space-y-1">
              <div className="font-semibold" style={{ color: "var(--sb-text)" }}>
                {activeLink.sourceNode.label} to {activeLink.targetNode.label}
              </div>
              <div>{formatInt(activeLink.value)} latest daily streams represented by this grouping.</div>
              <div>Total streams: {activeLink.total != null ? formatInt(activeLink.total) : "not available"}.</div>
            </div>
          ) : activeNodeId ? (
            <div className="mt-2">
              <div className="font-semibold" style={{ color: "var(--sb-text)" }}>
                {nodesById.get(activeNodeId)?.label}
              </div>
              <div>Connected flows stay highlighted for quick tracing.</div>
            </div>
          ) : (
            <div className="mt-2">Point at a link or node to isolate one grouping route through the catalog.</div>
          )}
        </div>
      </div>
    </div>
  );
}
