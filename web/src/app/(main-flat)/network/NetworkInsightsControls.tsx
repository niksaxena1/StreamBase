"use client";
import type { ThemeColors } from "@/components/charts/useThemeColors";
import { formatInt } from "@/lib/format";
import { DAY_MS } from "./networkInsights";
export type NetworkCluster = {
    id: string;
    name: string;
    artistIds: string[];
    dailyStreams: number | null;
};
export function NetworkTimeSlider({ minDay, maxDay, throughDay, onChange, onCommit, highlightRecent, onToggleRecent, unknownCount, visibleCount, colors }: {
    minDay: number | null;
    maxDay: number | null;
    throughDay: number | null;
    onChange: (day: number | null) => void;
    onCommit: (day: number | null) => void;
    highlightRecent: boolean;
    onToggleRecent: () => void;
    unknownCount: number;
    visibleCount: number;
    colors: ThemeColors;
}) {
    const formatDay = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);
    const value = minDay != null && maxDay != null ? Math.max(minDay, Math.min(maxDay + 1, throughDay ?? maxDay + 1)) : 0;
    const readValue = (raw: string) => maxDay != null && Number(raw) > maxDay ? null : Number(raw);
    return (<div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-xs" style={{ borderColor: colors.border, backgroundColor: colors.card, color: colors.muted }}>
      <label htmlFor="network-time">Collaborations</label>
      <input id="network-time" type="range" className="min-w-24 flex-1 max-w-80" style={{ accentColor: colors.accent }} min={minDay ?? 0} max={maxDay != null ? maxDay + 1 : 0} step={1} value={value} disabled={minDay == null} aria-label="Collaborations first appearing through date" aria-valuetext={throughDay == null ? "All time" : `Through ${formatDay(throughDay)}`} onChange={(event) => onChange(readValue(event.target.value))} onPointerUp={(event) => onCommit(readValue(event.currentTarget.value))} onKeyUp={(event) => { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key))
        onCommit(readValue(event.currentTarget.value)); }} onBlur={(event) => onCommit(readValue(event.currentTarget.value))}/>
      <span className="tabular-nums" style={{ color: colors.text }}>{throughDay == null ? "All time" : `Through ${formatDay(throughDay)}`}</span>
      <button type="button" className="rounded px-2 py-1" onClick={() => { onChange(null); onCommit(null); }} disabled={throughDay == null}>All time</button>
      <label className="flex items-center gap-1.5 whitespace-nowrap">
        <input type="checkbox" checked={highlightRecent} onChange={onToggleRecent} style={{ accentColor: colors.accent }}/> Highlight last 30 days
      </label>
      <span className="tabular-nums">{formatInt(visibleCount)} collaborations{unknownCount > 0 ? ` · ${formatInt(unknownCount)} undated (All time only)` : ""}</span>
    </div>);
}
export function NetworkClustersPanel({ clusters, loading, activeCluster, onSelect, colors, clusterColors, isCrossLabelMode }: {
    clusters: NetworkCluster[];
    loading: boolean;
    activeCluster: string | null;
    onSelect: (cluster: NetworkCluster | null) => void;
    colors: ThemeColors;
    clusterColors: Map<string, string>;
    isCrossLabelMode: boolean;
}) {
    return (<aside aria-label="Clusters" className="w-full max-h-44 sm:max-h-none sm:w-60 shrink-0 overflow-y-auto border-t sm:border-t-0 sm:border-l p-3" style={{ backgroundColor: colors.card, borderColor: colors.border }}>
      <div className="mb-2 flex items-center justify-between text-sm font-medium" style={{ color: colors.text }}>
        Clusters {activeCluster && <button type="button" onClick={() => onSelect(null)} className="text-xs" style={{ color: colors.muted }}>Clear highlight</button>}
      </div>
      {loading ? <p className="text-xs" style={{ color: colors.muted }}>Finding communities…</p> : (<div className="space-y-1">
          {clusters.map((cluster) => (<button key={cluster.id} type="button" aria-pressed={activeCluster === cluster.id} onClick={() => onSelect(activeCluster === cluster.id ? null : cluster)} className="w-full rounded-lg border px-2 py-2 text-left" style={{ borderColor: activeCluster === cluster.id ? colors.accent : "transparent", color: colors.text }}>
              <div className="flex items-start gap-2 text-xs font-medium">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: clusterColors.get(cluster.id) }}/>
                <span>{cluster.name}</span>
              </div>
              <div className="mt-1 pl-4 text-[11px] tabular-nums" style={{ color: colors.muted }}>{formatInt(cluster.artistIds.length)} {isCrossLabelMode ? "labels" : "artists"} · {cluster.dailyStreams == null ? "—" : formatInt(cluster.dailyStreams)} daily streams</div>
            </button>))}
        </div>)}
    </aside>);
}
