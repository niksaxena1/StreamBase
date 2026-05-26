"use client";

import { useMemo } from "react";
import type { NetworkArtistStreamExportRow } from "@/lib/networkViewXlsx";
import type { ThemeColors } from "@/components/charts/useThemeColors";
import type { GraphNode } from "./page";
import type { CollabCountBasis, NetworkTableSortKey } from "./networkGraphTypes";
import { useNetworkMetricStreams } from "./useNetworkMetricStreams";
import { PreviewableArtwork } from "@/components/ui/PreviewableArtwork";

export function NetworkArtistsTable({
  nodes,
  trackCollabFilterMap,
  graphDegreeMap,
  collabCountBasis,
  colors,
  sortKey,
  sortDir,
  onSortColumn,
  onRowActivate,
  streamStatsById,
  streamsLoading,
  streamsError,
}: {
  nodes: GraphNode[];
  trackCollabFilterMap: Map<string, number>;
  graphDegreeMap: Map<string, number>;
  collabCountBasis: CollabCountBasis;
  colors: ThemeColors;
  sortKey: NetworkTableSortKey;
  sortDir: "asc" | "desc";
  onSortColumn: (key: NetworkTableSortKey) => void;
  onRowActivate: (artistId: string) => void;
  streamStatsById: Map<string, NetworkArtistStreamExportRow> | null;
  streamsLoading: boolean;
  streamsError: boolean;
}) {
  const { metricColor, formatFromStreamCount, sortKeyFromStreamCount, totalColumnLabel, dailyColumnLabel } =
    useNetworkMetricStreams();

  const sorted = useMemo(() => {
    const arr = [...nodes];
    const dir = sortDir === "asc" ? 1 : -1;
    const streamPick = (id: string, field: "total" | "daily"): number | null => {
      const r = streamStatsById?.get(id);
      if (!r) return null;
      const raw = field === "total" ? r.total_streams_in_scope : r.daily_streams_in_scope;
      return sortKeyFromStreamCount(raw);
    };
    const streamCmp = (aId: string, bId: string, field: "total" | "daily"): number => {
      const va = streamPick(aId, field);
      const vb = streamPick(bId, field);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      return va - vb;
    };
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") cmp = a.name.localeCompare(b.name);
      else if (sortKey === "track_count") cmp = (a.track_count ?? 0) - (b.track_count ?? 0);
      else if (sortKey === "co")
        cmp = (trackCollabFilterMap.get(a.id) ?? 0) - (trackCollabFilterMap.get(b.id) ?? 0);
      else if (sortKey === "deg")
        cmp = (graphDegreeMap.get(a.id) ?? 0) - (graphDegreeMap.get(b.id) ?? 0);
      else if (sortKey === "streams_total") cmp = streamCmp(a.id, b.id, "total");
      else if (sortKey === "streams_daily") cmp = streamCmp(a.id, b.id, "daily");
      else cmp = 0;
      return cmp * dir || a.name.localeCompare(b.name);
    });
    return arr;
  }, [
    nodes,
    sortKey,
    sortDir,
    trackCollabFilterMap,
    graphDegreeMap,
    streamStatsById,
    sortKeyFromStreamCount,
  ]);

  const thBtn = (key: NetworkTableSortKey, label: string, className?: string) => (
    <button
      type="button"
      className={`inline-flex items-center gap-0.5 font-medium hover:opacity-90 ${className ?? ""}`}
      style={{ color: colors.text }}
      onClick={() => onSortColumn(key)}
    >
      {label}
      {sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
    </button>
  );

  const coHead =
    collabCountBasis === "playlist" ? "Co-artists (playlist)" : "Co-artists (lead)";

  return (
    <div
      className="flex shrink-0 flex-col overflow-hidden border-t"
      style={{ borderColor: colors.border, backgroundColor: colors.card }}
    >
      <div
        className="flex flex-col gap-1 px-4 py-2 text-xs font-semibold sm:flex-row sm:items-center sm:justify-between"
        style={{ color: colors.text }}
      >
        <span>Visible artists ({sorted.length})</span>
        <span className="font-normal opacity-70">
          Same scope as the graph · totals match Excel Artists (in-scope stream counts × global metric) · row =
          focus on graph
        </span>
        {streamsError ? (
          <span className="font-normal text-[11px]" style={{ color: colors.muted }}>
            Stream totals failed to load — columns show “—”.
          </span>
        ) : null}
      </div>
      <div className="max-h-[min(50vh,440px)] overflow-auto px-2 pb-3">
        <table className="w-full border-collapse text-left text-xs">
          <thead
            className="sticky top-0 z-[1]"
            style={{
              backgroundColor: colors.card,
              boxShadow: `inset 0 -1px 0 ${colors.border}`,
              color: colors.muted,
            }}
          >
            <tr>
              <th className="w-9 py-2 pl-2 pr-1" aria-hidden />
              <th className="py-2 pr-2">{thBtn("name", "Name")}</th>
              <th className="whitespace-nowrap py-2 pr-2 text-right">
                {thBtn("track_count", "Tracks", "justify-end w-full")}
              </th>
              <th
                className="whitespace-nowrap py-2 pr-2 text-right"
                title={`${totalColumnLabel} in current graph scope (underlying data: stream counts)`}
              >
                {thBtn("streams_total", totalColumnLabel, "justify-end w-full")}
              </th>
              <th
                className="whitespace-nowrap py-2 pr-2 text-right"
                title={`${dailyColumnLabel} in current graph scope`}
              >
                {thBtn("streams_daily", dailyColumnLabel, "justify-end w-full")}
              </th>
              <th className="whitespace-nowrap py-2 pr-2 text-right">
                {thBtn("co", coHead, "justify-end w-full")}
              </th>
              <th className="whitespace-nowrap py-2 pr-2 text-right">
                {thBtn("deg", "Graph links", "justify-end w-full")}
              </th>
            </tr>
          </thead>
          <tbody style={{ color: colors.text }}>
            {sorted.map((n) => (
              <tr
                key={n.id}
                tabIndex={0}
                className="cursor-pointer border-b border-black/5 transition-colors hover:bg-black/[0.04] dark:border-white/10 dark:hover:bg-white/[0.06]"
                style={{ borderColor: colors.border }}
                onClick={() => onRowActivate(n.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onRowActivate(n.id);
                  }
                }}
              >
                <td className="py-1.5 pl-2 pr-1">
                  {n.image_url ? (
                    <PreviewableArtwork
                      src={n.image_url}
                      alt=""
                      width={24}
                      height={24}
                      className="h-6 w-6 shrink-0 rounded-full object-cover"
                      interactive="inline"
                      label={n.name}
                    />
                  ) : (
                    <div
                      className="h-6 w-6 shrink-0 rounded-full"
                      style={{ backgroundColor: `${colors.accent}40` }}
                      aria-hidden
                    />
                  )}
                </td>
                <td className="max-w-[12rem] truncate py-1.5 pr-2 font-medium">{n.name}</td>
                <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{n.track_count}</td>
                <td
                  className="py-1.5 pr-2 text-right font-mono text-[11px] font-medium tabular-nums"
                  style={{ color: metricColor }}
                >
                  {streamsLoading ? (
                    <span className="opacity-50">…</span>
                  ) : (
                    formatFromStreamCount(streamStatsById?.get(n.id)?.total_streams_in_scope)
                  )}
                </td>
                <td
                  className="py-1.5 pr-2 text-right font-mono text-[11px] font-medium tabular-nums opacity-90"
                  style={{ color: metricColor }}
                >
                  {streamsLoading ? (
                    <span className="opacity-50">…</span>
                  ) : (
                    formatFromStreamCount(streamStatsById?.get(n.id)?.daily_streams_in_scope)
                  )}
                </td>
                <td className="py-1.5 pr-2 text-right font-mono tabular-nums">
                  {trackCollabFilterMap.get(n.id) ?? 0}
                </td>
                <td className="py-1.5 pr-2 text-right font-mono tabular-nums">
                  {graphDegreeMap.get(n.id) ?? 0}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
