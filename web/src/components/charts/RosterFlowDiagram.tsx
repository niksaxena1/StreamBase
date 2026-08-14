"use client";

import { useMemo, useState } from "react";

import { formatInt } from "@/lib/format";
import { useThemeColors } from "@/components/charts/useThemeColors";
import { OUTSIDE_TRACKED_SET, type RosterFlow } from "@/lib/rosterFlow";

type FlowNode = { name: string; x: number; y: number; width: number; height: number; total: number };

function flowPath(source: FlowNode, target: FlowNode) {
  const x0 = source.x + source.width;
  const x1 = target.x;
  const y0 = source.y + source.height / 2;
  const y1 = target.y + target.height / 2;
  const bend = (x1 - x0) * 0.5;
  return `M ${x0} ${y0} C ${x0 + bend} ${y0}, ${x1 - bend} ${y1}, ${x1} ${y1}`;
}

export function trackCountLabel(count: number): string {
  return `${formatInt(count)} ${count === 1 ? "track" : "tracks"}`;
}

/**
 * Two-column flow diagram of roster movement between groups (competitor labels
 * or own-catalog distro playlists). Band width represents track count, scaled
 * by organic movement only so initial imports render de-emphasized.
 */
export type RosterFlowFixedNode = { name: string; imageUrl?: string | null };

export function RosterFlowDiagram({
  flows,
  nodeColors,
  importTargets,
  outsideSourceLabel = "New to tracked set",
  outsideTargetLabel = "Left tracked set",
  ariaLabel = "Roster movements between tracked groups",
  emptyMessage = "No roster movement in this window.",
  onFlowClick,
  fixedNodes,
}: {
  flows: RosterFlow[];
  /** Display name → color. Unknown names fall back to the info color. */
  nodeColors: Map<string, string>;
  /** Display names of groups whose inflow this window is an initial import. */
  importTargets?: string[];
  outsideSourceLabel?: string;
  outsideTargetLabel?: string;
  ariaLabel?: string;
  emptyMessage?: string;
  /** When provided, bands become clickable (e.g. to open a track drill-down). */
  onFlowClick?: (flow: RosterFlow) => void;
  /**
   * When provided, BOTH columns render exactly these groups in this order —
   * including groups with no movement — as compact cards with thumbnails.
   * Flows touching groups outside the list (e.g. the outside-tracked-set
   * sentinel) are not drawn. Without it, columns derive from the flows.
   */
  fixedNodes?: RosterFlowFixedNode[];
}) {
  const colors = useThemeColors();
  const [activeFlow, setActiveFlow] = useState<string | null>(null);
  // Stored thumbnail URLs can go stale (Spotify mosaic ids rotate); fall back
  // to the color bar instead of the browser's broken-image glyph.
  const [failedImages, setFailedImages] = useState<ReadonlySet<string>>(new Set());
  const importSet = useMemo(() => new Set(importTargets ?? []), [importTargets]);
  const isImportFlow = (flow: RosterFlow) =>
    flow.source === OUTSIDE_TRACKED_SET && importSet.has(flow.target);
  const fixedNames = useMemo(() => new Set((fixedNodes ?? []).map((node) => node.name)), [fixedNodes]);
  const topFlows = useMemo(() => {
    const usable = fixedNodes
      ? flows.filter((flow) => fixedNames.has(flow.source) && fixedNames.has(flow.target))
      : flows;
    return usable.slice(0, 18);
  }, [flows, fixedNodes, fixedNames]);
  const compact = Boolean(fixedNodes);

  /** "Outside tracked set" means different things per side; label each honestly. */
  const nodeDisplayName = (name: string, side: "source" | "target"): string => {
    if (name !== OUTSIDE_TRACKED_SET) return name;
    return side === "source" ? outsideSourceLabel : outsideTargetLabel;
  };

  const layout = useMemo(() => {
    const width = 960;
    const nodeWidth = 170;
    const sources = fixedNodes ? fixedNodes.map((node) => node.name) : [...new Set(topFlows.map((flow) => flow.source))];
    const targets = fixedNodes ? fixedNodes.map((node) => node.name) : [...new Set(topFlows.map((flow) => flow.target))];
    const sourceTotals = new Map<string, number>();
    const targetTotals = new Map<string, number>();
    topFlows.forEach((flow) => {
      sourceTotals.set(flow.source, (sourceTotals.get(flow.source) ?? 0) + flow.track_count);
      targetTotals.set(flow.target, (targetTotals.get(flow.target) ?? 0) + flow.track_count);
    });
    // Compact fixed columns pack more rows: size the canvas to the row count.
    const rows = Math.max(sources.length, targets.length, 1);
    const slotSize = compact ? 34 : Math.max(42, (360 - 48) / rows);
    const nodeHeight = compact ? 28 : Math.min(38, slotSize - 6);
    const height = compact ? 48 + rows * slotSize : 360;
    const makeNodes = (names: string[], x: number, totals: Map<string, number>) => {
      const slot = compact ? slotSize : Math.max(42, (height - 48) / Math.max(1, names.length));
      return names.map((name, index): FlowNode => ({
        name,
        x,
        y: 24 + index * slot,
        width: nodeWidth,
        height: nodeHeight,
        total: totals.get(name) ?? 0,
      }));
    };
    const sourceNodes = makeNodes(sources, 20, sourceTotals);
    const targetNodes = makeNodes(targets, width - nodeWidth - 20, targetTotals);
    const bySource = new Map(sourceNodes.map((node) => [node.name, node]));
    const byTarget = new Map(targetNodes.map((node) => [node.name, node]));
    // Scale band widths by ORGANIC movement only: a 400-track initial import
    // would otherwise flatten every real flow to a hairline.
    const organic = topFlows.filter((flow) => !(flow.source === OUTSIDE_TRACKED_SET && importSet.has(flow.target)));
    const maxFlow = Math.max(1, ...(organic.length ? organic : topFlows).map((flow) => flow.track_count));
    return { width, height, sourceNodes, targetNodes, bySource, byTarget, maxFlow };
  }, [topFlows, importSet, fixedNodes, compact]);

  const imageByName = useMemo(
    () => new Map((fixedNodes ?? []).map((node) => [node.name, node.imageUrl ?? null])),
    [fixedNodes],
  );

  if (!topFlows.length && !fixedNodes) {
    return <div className="flex min-h-64 items-center justify-center text-xs" style={{ color: colors.muted }}>{emptyMessage}</div>;
  }

  const nodeColor = (name: string) =>
    name === OUTSIDE_TRACKED_SET ? colors.muted : nodeColors.get(name) ?? colors.info;

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        className="min-h-[300px] min-w-[760px] w-full"
        role="img"
        aria-label={ariaLabel}
      >
        <text x="20" y="14" fill={colors.muted} fontSize="11">From</text>
        <text x={layout.width - 190} y="14" fill={colors.muted} fontSize="11">To</text>
        <g fill="none">
          {topFlows.map((flow) => {
            const source = layout.bySource.get(flow.source);
            const target = layout.byTarget.get(flow.target);
            if (!source || !target) return null;
            const key = `${flow.source}-${flow.target}`;
            const active = activeFlow == null || activeFlow === key;
            const importFlow = isImportFlow(flow);
            const flowTitle = `${nodeDisplayName(flow.source, "source")} to ${nodeDisplayName(flow.target, "target")}: ${trackCountLabel(flow.track_count)}${importFlow ? " (initial roster import)" : ""}`;
            return (
              <path
                key={key}
                d={flowPath(source, target)}
                stroke={nodeColor(flow.source)}
                strokeWidth={
                  importFlow ? 10 : Math.max(2, Math.min(22, (flow.track_count / layout.maxFlow) * 22))
                }
                strokeLinecap="round"
                strokeDasharray={importFlow ? "6 8" : undefined}
                opacity={importFlow ? (active ? 0.22 : 0.05) : active ? 0.42 : 0.07}
                className={onFlowClick ? "cursor-pointer transition-opacity" : "transition-opacity"}
                onMouseEnter={() => setActiveFlow(key)}
                onMouseLeave={() => setActiveFlow(null)}
                onClick={onFlowClick ? () => onFlowClick(flow) : undefined}
                role={onFlowClick ? "button" : undefined}
                tabIndex={onFlowClick ? 0 : undefined}
                aria-label={onFlowClick ? `${flowTitle}. Open track list.` : undefined}
                onKeyDown={
                  onFlowClick
                    ? (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onFlowClick(flow);
                        }
                      }
                    : undefined
                }
              >
                <title>{flowTitle}</title>
              </path>
            );
          })}
        </g>
        {compact && !topFlows.length ? (
          <text
            x={layout.width / 2}
            y={layout.height / 2}
            fill={colors.muted}
            fontSize="11"
            textAnchor="middle"
          >
            {emptyMessage}
          </text>
        ) : null}
        {[...layout.sourceNodes, ...layout.targetNodes].map((node, index) => {
          const side = index < layout.sourceNodes.length ? ("source" as const) : ("target" as const);
          const display = nodeDisplayName(node.name, side);
          const rawImageUrl = imageByName.get(node.name) ?? null;
          const imageUrl = rawImageUrl && !failedImages.has(rawImageUrl) ? rawImageUrl : null;
          const clipId = `rf-thumb-${side}-${index}`;
          if (compact) {
            const thumbSize = node.height - 8;
            const textX = node.x + (imageUrl ? thumbSize + 10 : 10) + 2;
            const maxChars = imageUrl ? 17 : 20;
            return (
              <g key={`${node.x}-${node.name}`}>
                <rect
                  x={node.x}
                  y={node.y}
                  width={node.width}
                  height={node.height}
                  rx="6"
                  fill={colors.card}
                  stroke={nodeColor(node.name)}
                  strokeOpacity="0.7"
                />
                {imageUrl ? (
                  <>
                    <clipPath id={clipId}>
                      <rect x={node.x + 4} y={node.y + 4} width={thumbSize} height={thumbSize} rx="4" />
                    </clipPath>
                    <image
                      href={imageUrl}
                      x={node.x + 4}
                      y={node.y + 4}
                      width={thumbSize}
                      height={thumbSize}
                      clipPath={`url(#${clipId})`}
                      preserveAspectRatio="xMidYMid slice"
                      onError={() =>
                        setFailedImages((previous) => {
                          if (previous.has(imageUrl)) return previous;
                          const next = new Set(previous);
                          next.add(imageUrl);
                          return next;
                        })
                      }
                    />
                  </>
                ) : (
                  <rect x={node.x + 4} y={node.y + 4} width="4" height={thumbSize} rx="2" fill={nodeColor(node.name)} />
                )}
                <text x={textX} y={node.y + node.height / 2 + 3.5} fill={colors.text} fontSize="10.5" fontWeight="600">
                  {display.length > maxChars ? `${display.slice(0, maxChars - 1)}…` : display}
                </text>
                {node.total > 0 ? (
                  <text
                    x={node.x + node.width - 8}
                    y={node.y + node.height / 2 + 3.5}
                    fill={colors.muted}
                    fontSize="9.5"
                    textAnchor="end"
                  >
                    {formatInt(node.total)}
                  </text>
                ) : null}
                <title>{`${display}: ${trackCountLabel(node.total)}`}</title>
              </g>
            );
          }
          return (
            <g key={`${node.x}-${node.name}`}>
              <rect
                x={node.x}
                y={node.y}
                width={node.width}
                height={node.height}
                rx="6"
                fill={colors.card}
                stroke={nodeColor(node.name)}
                strokeOpacity="0.7"
              />
              <rect x={node.x} y={node.y} width="4" height={node.height} rx="2" fill={nodeColor(node.name)} />
              <text x={node.x + 12} y={node.y + 15} fill={colors.text} fontSize="11" fontWeight="600">
                {display.length > 23 ? `${display.slice(0, 22)}...` : display}
              </text>
              <text x={node.x + 12} y={node.y + 29} fill={colors.muted} fontSize="10">
                {trackCountLabel(node.total)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
