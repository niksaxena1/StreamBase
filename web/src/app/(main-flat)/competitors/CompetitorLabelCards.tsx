"use client";

import { PreviewableArtwork } from "@/components/ui/PreviewableArtwork";

import type { LabelComparisonRow, PlaylistRow } from "./competitorsTypes";
import { formatStreamMetricDelta, streamMetricDeltaColor, useCompetitorStreamMetric } from "./competitorStreamMetric";
import { labelSummaryCardStyle } from "./competitorsUtils";
import { formatInt } from "@/lib/format";

function DeltaLine({
  delta,
  periodLabel,
  title,
  useStreamMetricScale,
  streamMetric,
}: {
  delta: number;
  periodLabel: string;
  title: string;
  useStreamMetricScale: boolean;
  streamMetric: ReturnType<typeof useCompetitorStreamMetric>;
}) {
  const countMetric = "streams" as const;
  const displayMetric = useStreamMetricScale ? streamMetric.displayMetric : countMetric;
  const scaled = useStreamMetricScale ? streamMetric.scale(delta) : delta;
  const deltaLabel = formatStreamMetricDelta(useStreamMetricScale ? scaled : delta, displayMetric);
  if (!deltaLabel) return null;
  return (
    <div
      className="flex items-baseline gap-1 font-mono text-[10px] tabular-nums"
      style={{ color: streamMetricDeltaColor(scaled) }}
      title={title}
    >
      <span>{deltaLabel}</span>
      <span className="font-sans text-[9px] font-medium uppercase opacity-55">{periodLabel}</span>
    </div>
  );
}

function LabelStat({
  label,
  value,
  delta,
  weeklyDelta,
  useStreamMetricScale = false,
  streamMetric,
}: {
  label: string;
  value: number;
  delta: number | null;
  weeklyDelta?: number | null;
  useStreamMetricScale?: boolean;
  streamMetric: ReturnType<typeof useCompetitorStreamMetric>;
}) {
  const displayDelta = useStreamMetricScale && delta != null ? streamMetric.scale(delta) : delta;
  const displayWeekly =
    useStreamMetricScale && weeklyDelta != null ? streamMetric.scale(weeklyDelta) : weeklyDelta;

  const activeMetric = useStreamMetricScale ? streamMetric.displayMetric : ("streams" as const);

  const showDeltas =
    formatStreamMetricDelta(displayDelta, activeMetric) ||
    (displayWeekly != null && displayWeekly !== 0);

  return (
    <div>
      <div className="text-[11px] uppercase opacity-60">{label}</div>
      <div
        className="font-mono"
        style={useStreamMetricScale && streamMetric.displayMetric === "revenue" ? { color: "#10b981" } : undefined}
      >
        {useStreamMetricScale ? streamMetric.format(value) : formatInt(value)}
      </div>
      {showDeltas ? (
        <div className="mt-0.5 space-y-0.5">
          {formatStreamMetricDelta(displayDelta, activeMetric) ? (
            <DeltaLine
              delta={delta!}
              periodLabel="1d"
              title="Change vs prior data date"
              useStreamMetricScale={useStreamMetricScale}
              streamMetric={streamMetric}
            />
          ) : null}
          {displayWeekly != null && displayWeekly !== 0 ? (
            <DeltaLine
              delta={weeklyDelta!}
              periodLabel="7d"
              title="Change vs data date 7 days earlier"
              useStreamMetricScale={useStreamMetricScale}
              streamMetric={streamMetric}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function CompetitorLabelCards({
  rows,
  playlistsByLabel,
}: {
  rows: LabelComparisonRow[];
  playlistsByLabel: Record<string, PlaylistRow[]>;
}) {
  const streamMetric = useCompetitorStreamMetric();
  const dailyLabel = streamMetric.displayMetric === "revenue" ? "Daily revenue" : "Daily streams";

  return (
    <div className="grid gap-3 md:grid-cols-3">
      {rows.map((row) => {
        const imageUrl =
          (playlistsByLabel[row.label.label_key] ?? []).find((p) => p.spotify_playlist_image_url)
            ?.spotify_playlist_image_url ?? null;
        return (
          <div key={row.label.label_key} className="sb-card p-4" style={labelSummaryCardStyle(row.label.accent_hex)}>
            <div className="flex items-center gap-3">
              {imageUrl ? (
                <PreviewableArtwork
                  src={imageUrl}
                  alt={row.label.display_name}
                  width={44}
                  height={44}
                  className="h-11 w-11 rounded-xl object-cover sb-ring"
                  label={row.label.display_name}
                />
              ) : (
                <div className="h-11 w-11 rounded-xl bg-white/10 sb-ring" />
              )}
              <div>
                <div className="font-display text-lg font-semibold">{row.label.display_name}</div>
                <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
                  {row.playlistCount} playlist{row.playlistCount === 1 ? "" : "s"}
                </div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
              <LabelStat
                label="Tracks"
                value={row.trackCount}
                delta={row.trackDelta}
                weeklyDelta={row.trackWeeklyDelta}
                streamMetric={streamMetric}
              />
              <LabelStat
                label="Artists"
                value={row.artistCount}
                delta={row.artistDelta}
                weeklyDelta={row.artistWeeklyDelta}
                streamMetric={streamMetric}
              />
              <LabelStat
                label={dailyLabel}
                value={row.dailyStreams}
                delta={row.dailyStreamDelta}
                useStreamMetricScale
                streamMetric={streamMetric}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
