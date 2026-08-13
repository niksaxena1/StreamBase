"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, RefreshCw } from "lucide-react";

import { fetchApiJson } from "@/lib/api";
import { formatInt } from "@/lib/format";
import { PreviewableArtwork } from "@/components/ui/PreviewableArtwork";
import { SectionErrorState } from "@/components/ui/DataStates";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { useThemeColors } from "@/components/charts/useThemeColors";

import { OUTSIDE_TRACKED_SET } from "./competitorWorkspaceAnalytics";
import type {
  CompetitorMovementInsights,
  LabelRow,
  RosterFlowRow,
} from "./competitorsTypes";
import { labelColor } from "./competitorsUtils";

type FlowNode = { name: string; x: number; y: number; width: number; height: number; total: number };

function flowPath(source: FlowNode, target: FlowNode) {
  const x0 = source.x + source.width;
  const x1 = target.x;
  const y0 = source.y + source.height / 2;
  const y1 = target.y + target.height / 2;
  const bend = (x1 - x0) * 0.5;
  return `M ${x0} ${y0} C ${x0 + bend} ${y0}, ${x1 - bend} ${y1}, ${x1} ${y1}`;
}

function RosterFlowDiagram({ flows, labels }: { flows: RosterFlowRow[]; labels: LabelRow[] }) {
  const colors = useThemeColors();
  const [activeFlow, setActiveFlow] = useState<string | null>(null);
  const labelColors = useMemo(
    () => new Map(labels.map((label, index) => [label.display_name, labelColor(label, index)])),
    [labels],
  );
  const topFlows = flows.slice(0, 18);
  const layout = useMemo(() => {
    const width = 960;
    const height = 360;
    const nodeWidth = 170;
    const sources = [...new Set(topFlows.map((flow) => flow.source))];
    const targets = [...new Set(topFlows.map((flow) => flow.target))];
    const sourceTotals = new Map<string, number>();
    const targetTotals = new Map<string, number>();
    topFlows.forEach((flow) => {
      sourceTotals.set(flow.source, (sourceTotals.get(flow.source) ?? 0) + flow.track_count);
      targetTotals.set(flow.target, (targetTotals.get(flow.target) ?? 0) + flow.track_count);
    });
    const makeNodes = (names: string[], x: number, totals: Map<string, number>) => {
      const slot = Math.max(42, (height - 48) / Math.max(1, names.length));
      return names.map((name, index): FlowNode => ({
        name,
        x,
        y: 24 + index * slot,
        width: nodeWidth,
        height: Math.min(38, slot - 6),
        total: totals.get(name) ?? 0,
      }));
    };
    const sourceNodes = makeNodes(sources, 20, sourceTotals);
    const targetNodes = makeNodes(targets, width - nodeWidth - 20, targetTotals);
    const bySource = new Map(sourceNodes.map((node) => [node.name, node]));
    const byTarget = new Map(targetNodes.map((node) => [node.name, node]));
    const maxFlow = Math.max(1, ...topFlows.map((flow) => flow.track_count));
    return { width, height, sourceNodes, targetNodes, bySource, byTarget, maxFlow };
  }, [topFlows]);

  if (!topFlows.length) {
    return <div className="flex min-h-64 items-center justify-center text-xs" style={{ color: colors.muted }}>No roster movement in this window.</div>;
  }

  const nodeColor = (name: string) =>
    name === OUTSIDE_TRACKED_SET ? colors.muted : labelColors.get(name) ?? colors.info;

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        className="min-h-[300px] min-w-[760px] w-full"
        role="img"
        aria-label="Roster movements between tracked competitor labels over the last 30 ingestion days"
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
            return (
              <path
                key={key}
                d={flowPath(source, target)}
                stroke={nodeColor(flow.source)}
                strokeWidth={Math.max(2, (flow.track_count / layout.maxFlow) * 22)}
                strokeLinecap="round"
                opacity={active ? 0.42 : 0.07}
                className="transition-opacity"
                onMouseEnter={() => setActiveFlow(key)}
                onMouseLeave={() => setActiveFlow(null)}
              >
                <title>{flow.source} to {flow.target}: {formatInt(flow.track_count)} tracks</title>
              </path>
            );
          })}
        </g>
        {[...layout.sourceNodes, ...layout.targetNodes].map((node, index) => (
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
              {node.name.length > 23 ? `${node.name.slice(0, 22)}...` : node.name}
            </text>
            <text x={node.x + 12} y={node.y + 29} fill={colors.muted} fontSize="10">
              {formatInt(node.total)} tracks
            </text>
            {index < layout.sourceNodes.length ? null : null}
          </g>
        ))}
      </svg>
    </div>
  );
}

export function CompetitorMovementDashboard({ latestRunDate, labels }: { latestRunDate: string; labels: LabelRow[] }) {
  const colors = useThemeColors();
  const [data, setData] = useState<CompetitorMovementInsights | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  function reload() {
    setLoading(true);
    setError(null);
    setData(null);
    setReloadKey((value) => value + 1);
  }

  useEffect(() => {
    let cancelled = false;
    void fetchApiJson<CompetitorMovementInsights>(
      `/api/competitors/workspace-insights?scope=movement&run_date=${encodeURIComponent(latestRunDate)}`,
    )
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [latestRunDate, reloadKey]);

  if (loading && !data) return <TableSkeleton rows={6} cols={4} />;
  if (error && !data) {
    return <SectionErrorState message={error} retry={reload} />;
  }

  const movements = data?.movements ?? [];
  const flows = data?.flows ?? [];
  const transfers = flows
    .filter((flow) => flow.source !== OUTSIDE_TRACKED_SET && flow.target !== OUTSIDE_TRACKED_SET)
    .reduce((sum, flow) => sum + flow.track_count, 0);
  const additions = flows
    .filter((flow) => flow.source === OUTSIDE_TRACKED_SET)
    .reduce((sum, flow) => sum + flow.track_count, 0);
  const exits = flows
    .filter((flow) => flow.target === OUTSIDE_TRACKED_SET)
    .reduce((sum, flow) => sum + flow.track_count, 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-px overflow-hidden rounded-lg border sm:grid-cols-3" style={{ borderColor: colors.border, background: colors.border }}>
        {[
          ["New entries", additions, colors.positive],
          ["Cross-label moves", transfers, colors.info],
          ["Tracked exits", exits, colors.error],
        ].map(([label, value, color]) => (
          <div key={String(label)} className="bg-[var(--sb-card)] px-4 py-3">
            <div className="text-[10px] font-medium uppercase tracking-wide" style={{ color: colors.muted }}>{label}</div>
            <div className="mt-1 font-mono text-lg font-semibold tabular-nums" style={{ color: String(color) }}>{formatInt(Number(value))}</div>
          </div>
        ))}
      </div>

      <section className="sb-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Roster flow</h2>
            <p className="mt-1 text-xs" style={{ color: colors.muted }}>
              Label-level membership intervals observed from {data?.window_start ?? "-"} through {data?.window_end ?? "-"}; width represents track count.
            </p>
          </div>
          <button
            type="button"
            className="sb-control rounded-full p-2 hover:bg-white/10"
            title="Refresh roster flow"
            aria-label="Refresh roster flow"
            onClick={reload}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="mt-2">
          <RosterFlowDiagram flows={flows} labels={labels} />
        </div>
      </section>

      {movements.length ? (
        <section className="sb-card overflow-hidden">
          <div className="border-b px-4 py-3" style={{ borderColor: colors.border }}>
            <h2 className="text-sm font-semibold">Recent track movement</h2>
          </div>
          <div className="divide-y" style={{ borderColor: colors.border }}>
            {movements.slice(0, 12).map((movement) => (
              <div key={`${movement.isrc}-${movement.source}-${movement.target}-${movement.event_date}`} className="grid grid-cols-[32px_minmax(0,1fr)] items-center gap-3 px-4 py-2.5 sm:grid-cols-[32px_minmax(0,1fr)_minmax(220px,0.8fr)_84px]">
                {movement.album_image_url ? (
                  <PreviewableArtwork src={movement.album_image_url} alt="" width={32} height={32} className="h-8 w-8 rounded-md object-cover" label={movement.name} />
                ) : <div className="h-8 w-8 rounded-md bg-white/10" />}
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium">{movement.name}</div>
                  <div className="truncate text-[10px]" style={{ color: colors.muted }}>{movement.artist_names?.join(", ") || movement.isrc}</div>
                </div>
                <div className="col-span-2 flex min-w-0 items-center gap-2 text-[10px] sm:col-span-1">
                  <span className="truncate">{movement.source}</span>
                  <ArrowRight className="h-3 w-3 shrink-0" style={{ color: colors.muted }} />
                  <span className="truncate">{movement.target}</span>
                </div>
                <time className="hidden text-right font-mono text-[10px] sm:block" style={{ color: colors.muted }}>{movement.event_date}</time>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
