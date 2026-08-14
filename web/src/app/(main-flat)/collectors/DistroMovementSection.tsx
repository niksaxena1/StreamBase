"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, RefreshCw } from "lucide-react";

import { fetchApiJson } from "@/lib/api";
import { formatDateISO, formatInt } from "@/lib/format";
import type { DistroMovementInsights, DistroMovementWindow } from "@/lib/collectors/distroMovement";
import { OUTSIDE_TRACKED_SET } from "@/lib/rosterFlow";
import { PreviewableArtwork } from "@/components/ui/PreviewableArtwork";
import { SectionErrorState } from "@/components/ui/DataStates";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { RosterFlowDiagram } from "@/components/charts/RosterFlowDiagram";
import { useThemeColors } from "@/components/charts/useThemeColors";
import { COLLECTOR_COLORS } from "@/components/charts/CollectorComparisonChart";

const WINDOW_OPTIONS: Array<{ days: DistroMovementWindow; label: string }> = [
  { days: 30, label: "30d" },
  { days: 90, label: "90d" },
  { days: 365, label: "12m" },
];

type FetchResult = {
  windowDays: DistroMovementWindow;
  data?: DistroMovementInsights;
  error?: string;
};

export function DistroMovementSection() {
  const colors = useThemeColors();
  const [windowDays, setWindowDays] = useState<DistroMovementWindow>(90);
  const [result, setResult] = useState<FetchResult | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  function reload() {
    setResult(null);
    setReloadKey((value) => value + 1);
  }

  useEffect(() => {
    let cancelled = false;
    void fetchApiJson<DistroMovementInsights>(`/api/collectors/distro-movement?window=${windowDays}`)
      .then((payload) => {
        if (!cancelled) setResult({ windowDays, data: payload });
      })
      .catch((reason) => {
        if (!cancelled) setResult({ windowDays, error: reason instanceof Error ? reason.message : String(reason) });
      });
    return () => {
      cancelled = true;
    };
  }, [windowDays, reloadKey]);

  // Results for a different window are stale; treat as loading.
  const current = result?.windowDays === windowDays ? result : null;
  const data = current?.data ?? null;
  const error = current?.error ?? null;
  const loading = !current;

  const nodeColors = useMemo(() => {
    const map = new Map<string, string>();
    for (const [displayName, collector] of Object.entries(data?.collector_by_playlist ?? {})) {
      map.set(displayName, COLLECTOR_COLORS[collector] ?? "var(--sb-muted)");
    }
    return map;
  }, [data?.collector_by_playlist]);

  const flows = data?.flows ?? [];
  const movements = data?.movements ?? [];
  const importSet = useMemo(() => new Set(data?.import_targets ?? []), [data?.import_targets]);
  const redistributions = flows
    .filter((flow) => flow.source !== OUTSIDE_TRACKED_SET && flow.target !== OUTSIDE_TRACKED_SET)
    .reduce((sum, flow) => sum + flow.track_count, 0);
  const newlyDistributed = flows
    .filter((flow) => flow.source === OUTSIDE_TRACKED_SET && !importSet.has(flow.target))
    .reduce((sum, flow) => sum + flow.track_count, 0);
  const takedowns = flows
    .filter((flow) => flow.target === OUTSIDE_TRACKED_SET)
    .reduce((sum, flow) => sum + flow.track_count, 0);

  return (
    <section className="sb-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Distro movement</h2>
          <p className="mt-1 text-xs" style={{ color: colors.muted }}>
            Tracks moving between distributor playlists (re-distributions), newly distributed, or taken down
            {data ? ` — ${formatDateISO(data.window_start)} through ${formatDateISO(data.window_end)}` : ""}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-full border" style={{ borderColor: colors.border }}>
            {WINDOW_OPTIONS.map((option) => (
              <button
                key={option.days}
                type="button"
                className="px-3 py-1.5 text-[11px] font-medium transition"
                style={{
                  background: option.days === windowDays ? "var(--sb-accent)" : "transparent",
                  color: option.days === windowDays ? "var(--sb-accent-text,#000)" : colors.muted,
                }}
                onClick={() => setWindowDays(option.days)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="sb-control rounded-full p-2 hover:bg-white/10"
            title="Refresh distro movement"
            aria-label="Refresh distro movement"
            onClick={reload}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {loading && !data ? (
        <div className="mt-4">
          <TableSkeleton rows={6} cols={4} />
        </div>
      ) : error && !data ? (
        <div className="mt-4">
          <SectionErrorState message={error} retry={reload} />
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div
            className="grid gap-px overflow-hidden rounded-lg border sm:grid-cols-3"
            style={{ borderColor: colors.border, background: colors.border }}
          >
            {[
              ["Re-distributions", redistributions, colors.info],
              ["Newly distributed", newlyDistributed, colors.positive],
              ["Takedowns", takedowns, colors.error],
            ].map(([label, value, color]) => (
              <div key={String(label)} className="bg-[var(--sb-card)] px-4 py-3">
                <div className="text-[10px] font-medium uppercase tracking-wide" style={{ color: colors.muted }}>
                  {label}
                </div>
                <div className="mt-1 font-mono text-lg font-semibold tabular-nums" style={{ color: String(color) }}>
                  {formatInt(Number(value))}
                </div>
              </div>
            ))}
          </div>

          {importSet.size > 0 ? (
            <p className="text-xs" style={{ color: colors.muted }}>
              Excludes initial imports from newly tracked {importSet.size === 1 ? "playlist" : "playlists"} (
              {[...importSet].join(", ")}) — shown faint in the flow below.
            </p>
          ) : null}

          <RosterFlowDiagram
            flows={flows}
            nodeColors={nodeColors}
            importTargets={data?.import_targets}
            outsideSourceLabel="Newly distributed"
            outsideTargetLabel="Taken down"
            ariaLabel="Track movement between distributor playlists"
            emptyMessage="No distro movement in this window."
          />

          {movements.length ? (
            <div>
              <h3 className="text-xs font-semibold" style={{ color: colors.muted }}>
                Recent moves
              </h3>
              <div className="mt-2 divide-y rounded-lg border" style={{ borderColor: colors.border }}>
                {movements.slice(0, 12).map((movement, index) => (
                  <div
                    key={`${movement.isrc}-${movement.source}-${movement.target}-${index}`}
                    className="flex items-center gap-3 px-3 py-2"
                  >
                    <PreviewableArtwork
                      src={movement.album_image_url}
                      alt=""
                      className="h-8 w-8 shrink-0 rounded"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium">{movement.name}</div>
                      <div className="truncate text-[10px]" style={{ color: colors.muted }}>
                        {(movement.artist_names ?? []).join(", ")}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5 text-[11px]" style={{ color: colors.muted }}>
                      <span>{movement.source === OUTSIDE_TRACKED_SET ? "Newly distributed" : movement.source}</span>
                      <ArrowRight className="h-3 w-3" />
                      <span>{movement.target === OUTSIDE_TRACKED_SET ? "Taken down" : movement.target}</span>
                    </div>
                    <time className="shrink-0 font-mono text-[10px]" style={{ color: colors.muted }}>
                      {formatDateISO(movement.event_date)}
                    </time>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
