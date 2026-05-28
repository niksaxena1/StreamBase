"use client";

import { Music } from "lucide-react";

import { PreviewableArtwork } from "@/components/ui/PreviewableArtwork";
import { competitorLabelThumbObjectPosition } from "@/lib/competitorLabelThumbFit";
import {
  isOwnCatalogLabelKey,
  OWN_CATALOG_ACCENT_HEX,
  ownCatalogAccentCssColor,
} from "@/lib/competitors/ownCatalog";

import type { LabelComparisonRow, PlaylistRow } from "./competitorsTypes";
import {
  formatStreamMetricDelta,
  streamMetricDeltaColor,
  useCompetitorStreamMetric,
} from "./competitorStreamMetric";
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
  useStreamMetricScale?: boolean;
  streamMetric?: ReturnType<typeof useCompetitorStreamMetric>;
}) {
  const countMetric = "streams" as const;
  const displayMetric =
    useStreamMetricScale && streamMetric ? streamMetric.displayMetric : countMetric;
  const scaled =
    useStreamMetricScale && streamMetric ? streamMetric.scale(delta) : delta;
  const deltaLabel = formatStreamMetricDelta(
    useStreamMetricScale && streamMetric ? scaled : delta,
    displayMetric,
  );
  if (!deltaLabel) return null;
  return (
    <div
      className="flex flex-wrap items-baseline gap-x-1 gap-y-0 font-mono text-[10px] tabular-nums"
      style={{ color: streamMetricDeltaColor(scaled) }}
      title={title}
    >
      <span className="break-all">{deltaLabel}</span>
      <span className="font-sans text-[9px] font-medium uppercase opacity-55">{periodLabel}</span>
    </div>
  );
}

function CardStat({
  label,
  value,
  weeklyDelta,
  streamMetric,
  useStreamFormat = false,
  dailyDelta,
}: {
  label: string;
  value: number;
  weeklyDelta?: number | null;
  dailyDelta?: number | null;
  streamMetric?: ReturnType<typeof useCompetitorStreamMetric>;
  useStreamFormat?: boolean;
}) {
  const displayMetric = streamMetric?.displayMetric ?? ("streams" as const);
  const displayDaily =
    dailyDelta != null && streamMetric ? streamMetric.scale(dailyDelta) : null;

  return (
    <div className="min-w-0">
      <div className="truncate text-[10px] uppercase tracking-wide opacity-60">{label}</div>
      <div
        className="mt-0.5 break-all font-mono text-[11px] leading-snug tabular-nums"
        style={useStreamFormat ? streamMetric?.valueStyle : undefined}
      >
        {useStreamFormat && streamMetric ? streamMetric.format(value) : formatInt(value)}
      </div>
      {weeklyDelta != null && weeklyDelta !== 0 ? (
        <DeltaLine
          delta={weeklyDelta}
          periodLabel="7d"
          title="Change vs data date 7 days earlier"
        />
      ) : null}
      {displayDaily != null && formatStreamMetricDelta(displayDaily, displayMetric) ? (
        <DeltaLine
          delta={dailyDelta!}
          periodLabel="1d"
          title="Net streams on latest data date vs prior data date"
          useStreamMetricScale
          streamMetric={streamMetric}
        />
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
  const totalLabel =
    streamMetric.displayMetric === "revenue" ? "Total revenue" : "Total streams";

  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
      {rows.map((row) => {
        const isOwnCatalog = isOwnCatalogLabelKey(row.label.label_key);
        const imageUrl = isOwnCatalog
          ? null
          : ((playlistsByLabel[row.label.label_key] ?? []).find((p) => p.spotify_playlist_image_url)
              ?.spotify_playlist_image_url ?? null);
        return (
          <div
            key={row.label.label_key}
            className="sb-card p-2.5 sm:p-3"
            style={labelSummaryCardStyle(
              isOwnCatalog ? OWN_CATALOG_ACCENT_HEX : row.label.accent_hex,
            )}
          >
            <div className="flex items-center gap-2">
              {isOwnCatalog ? (
                <div
                  className="sb-ring flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                  style={{ background: ownCatalogAccentCssColor() }}
                  aria-hidden
                >
                  <Music className="h-4 w-4" style={{ color: "black" }} />
                </div>
              ) : imageUrl ? (
                <PreviewableArtwork
                  src={imageUrl}
                  alt={row.label.display_name}
                  width={32}
                  height={32}
                  className="h-8 w-8 shrink-0 rounded-full object-cover sb-ring"
                  objectPosition={competitorLabelThumbObjectPosition(row.label.label_key)}
                  label={row.label.display_name}
                />
              ) : (
                <div className="h-8 w-8 shrink-0 rounded-full bg-white/10 sb-ring" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate font-display text-sm font-semibold leading-tight">
                  {row.label.display_name}
                </div>
                <div className="text-[10px] leading-tight" style={{ color: "var(--sb-muted)" }}>
                  {row.playlistCount} playlist{row.playlistCount === 1 ? "" : "s"}
                </div>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-x-2 gap-y-0">
              <CardStat label="Tracks" value={row.trackCount} weeklyDelta={row.trackWeeklyDelta} />
              <CardStat label="Artists" value={row.artistCount} weeklyDelta={row.artistWeeklyDelta} />
              <CardStat
                label={totalLabel}
                value={row.totalStreams}
                dailyDelta={row.dailyStreamDelta}
                streamMetric={streamMetric}
                useStreamFormat
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
