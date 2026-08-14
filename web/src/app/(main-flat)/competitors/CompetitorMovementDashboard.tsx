"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, RefreshCw } from "lucide-react";

import { fetchApiJson } from "@/lib/api";
import { formatInt } from "@/lib/format";
import { PreviewableArtwork } from "@/components/ui/PreviewableArtwork";
import { SectionErrorState } from "@/components/ui/DataStates";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { useThemeColors } from "@/components/charts/useThemeColors";

import { RosterFlowDiagram } from "@/components/charts/RosterFlowDiagram";
import { OUTSIDE_TRACKED_SET } from "@/lib/rosterFlow";
import type { CompetitorMovementInsights, LabelRow } from "./competitorsTypes";
import { labelColor } from "./competitorsUtils";

export function CompetitorMovementDashboard({
  latestRunDate,
  labels,
  trackCountByLabelKey,
}: {
  latestRunDate: string;
  labels: LabelRow[];
  /** Current tracked-track count per label, used to spot initial roster imports. */
  trackCountByLabelKey?: Record<string, number>;
}) {
  const colors = useThemeColors();
  const labelColorsByName = useMemo(
    () => new Map(labels.map((label, index) => [label.display_name, labelColor(label, index)])),
    [labels],
  );
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

  // When a competitor is first onboarded its entire roster arrives from
  // "outside the tracked set" on one day. That is an import, not label
  // movement, so it is reported separately instead of inflating "New entries".
  const rosterImports = (() => {
    if (!trackCountByLabelKey) return { total: 0, labelNames: [] as string[] };
    const trackCountByName = new Map<string, number>();
    for (const label of labels) {
      const count = trackCountByLabelKey[label.label_key];
      if (typeof count === "number" && count > 0) trackCountByName.set(label.display_name, count);
    }
    let total = 0;
    const labelNames: string[] = [];
    for (const flow of flows) {
      if (flow.source !== OUTSIDE_TRACKED_SET) continue;
      const rosterSize = trackCountByName.get(flow.target);
      if (!rosterSize) continue;
      // ≥90% of the label's current roster entered within this window. The
      // absolute floor keeps a tiny label's genuine additions from being
      // misread as an import.
      if (flow.track_count >= 25 && flow.track_count >= rosterSize * 0.9) {
        total += flow.track_count;
        labelNames.push(flow.target);
      }
    }
    return { total, labelNames };
  })();
  const organicAdditions = additions - rosterImports.total;

  return (
    <div className="space-y-4">
      <div className="grid gap-px overflow-hidden rounded-lg border sm:grid-cols-3" style={{ borderColor: colors.border, background: colors.border }}>
        {[
          ["New entries", organicAdditions, colors.positive],
          ["Cross-label moves", transfers, colors.info],
          ["Tracked exits", exits, colors.error],
        ].map(([label, value, color]) => (
          <div key={String(label)} className="bg-[var(--sb-card)] px-4 py-3">
            <div className="text-[10px] font-medium uppercase tracking-wide" style={{ color: colors.muted }}>{label}</div>
            <div className="mt-1 font-mono text-lg font-semibold tabular-nums" style={{ color: String(color) }}>{formatInt(Number(value))}</div>
          </div>
        ))}
      </div>

      {rosterImports.total > 0 ? (
        <p className="text-xs" style={{ color: colors.muted }}>
          Excludes {formatInt(rosterImports.total)} tracks from newly tracked{" "}
          {rosterImports.labelNames.length === 1 ? "label" : "labels"} ({rosterImports.labelNames.join(", ")}) — their
          initial roster import, not roster movement. The flow below still shows them.
        </p>
      ) : null}

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
          <RosterFlowDiagram
            flows={flows}
            nodeColors={labelColorsByName}
            importTargets={rosterImports.labelNames}
            ariaLabel="Roster movements between tracked competitor labels over the last 30 ingestion days"
          />
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
