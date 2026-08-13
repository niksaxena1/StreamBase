"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

import { fetchApiJson } from "@/lib/api";
import { formatInt } from "@/lib/format";
import { formatKmbTick } from "@/components/charts/chartUtils";
import { useThemeColors } from "@/components/charts/useThemeColors";
import { PreviewableArtwork } from "@/components/ui/PreviewableArtwork";
import { SectionErrorState } from "@/components/ui/DataStates";
import { TableSkeleton } from "@/components/ui/Skeleton";

import { median } from "./competitorWorkspaceAnalytics";
import type {
  ArtistMomentumRow,
  CompetitorCatalogInsights,
  LabelRow,
} from "./competitorsTypes";
import { labelColor } from "./competitorsUtils";

function MomentumTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: ArtistMomentumRow }> }) {
  const colors = useThemeColors();
  if (!active || !payload?.[0]?.payload) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-lg border p-3 text-xs" style={{ background: colors.card, borderColor: colors.border, boxShadow: "var(--sb-shadow-compact)" }}>
      <div className="font-semibold">{row.artist_name}</div>
      <div className="mt-1" style={{ color: colors.muted }}>{formatInt(Math.round(row.total_per_track))} total / track</div>
      <div style={{ color: row.daily_per_track >= 0 ? colors.positive : colors.error }}>{row.daily_per_track >= 0 ? "+" : ""}{formatInt(Math.round(row.daily_per_track))} daily / track</div>
      <div style={{ color: colors.muted }}>{formatInt(row.track_count)} tracked tracks</div>
    </div>
  );
}

export function CompetitorCatalogIntelligence({
  latestRunDate,
  labels,
}: {
  latestRunDate: string;
  labels: LabelRow[];
}) {
  const colors = useThemeColors();
  const [data, setData] = useState<CompetitorCatalogInsights | null>(null);
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
    void fetchApiJson<CompetitorCatalogInsights>(
      `/api/competitors/workspace-insights?scope=catalog&run_date=${encodeURIComponent(latestRunDate)}`,
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

  const artists = useMemo(() => data?.artists ?? [], [data?.artists]);
  const scatterRows = useMemo(
    () => artists.filter((row) => row.total_per_track > 0).slice(0, 250),
    [artists],
  );
  const xMedian = useMemo(() => median(scatterRows.map((row) => row.total_per_track)), [scatterRows]);
  const yMedian = useMemo(() => median(scatterRows.map((row) => row.daily_per_track)), [scatterRows]);
  const leaderboard = useMemo(
    () => [...artists].sort((a, b) => b.daily_streams - a.daily_streams).slice(0, 15),
    [artists],
  );
  const cohortMonths = useMemo(
    () => [...new Set((data?.cohorts ?? []).map((row) => row.release_month))].sort().slice(-10),
    [data?.cohorts],
  );
  const ageBands = ["0-2w", "3-4w", "5-8w", "9-12w", "13w+"];
  const cohortLookup = useMemo(
    () => new Map((data?.cohorts ?? []).map((row) => [`${row.release_month}|${row.age_band}`, row])),
    [data?.cohorts],
  );
  const maxCohortDaily = Math.max(1, ...(data?.cohorts ?? []).map((row) => Math.abs(row.median_daily_streams)));
  const labelByKey = useMemo(() => new Map(labels.map((label) => [label.label_key, label])), [labels]);

  if (loading && !data) return <TableSkeleton rows={8} cols={5} />;
  if (error && !data) return <SectionErrorState message={error} retry={reload} />;

  return (
    <div className="space-y-4">
      <section className="sb-card p-4">
        <div>
          <h2 className="text-sm font-semibold">Artist position</h2>
          <p className="mt-1 text-xs" style={{ color: colors.muted }}>
            Current streams per tracked track. Quadrants split at the visible medians; bubble size represents track count.
          </p>
        </div>
        <div className="mt-3 h-[360px] min-w-0">
          <ResponsiveContainer
            width="100%"
            height="100%"
            minWidth={0}
            initialDimension={{ width: 960, height: 360 }}
          >
            <ScatterChart margin={{ top: 10, right: 18, bottom: 12, left: 4 }}>
              <CartesianGrid stroke={colors.border} />
              <XAxis
                type="number"
                dataKey="total_per_track"
                name="Total per track"
                scale="log"
                domain={[1, "auto"]}
                tick={{ fill: colors.muted, fontSize: 10 }}
                tickFormatter={formatKmbTick}
                label={{ value: "Total streams / track", position: "insideBottom", offset: -7, fill: colors.muted, fontSize: 10 }}
              />
              <YAxis
                type="number"
                dataKey="daily_per_track"
                name="Daily per track"
                domain={["auto", "auto"]}
                tick={{ fill: colors.muted, fontSize: 10 }}
                tickFormatter={formatKmbTick}
                width={54}
              />
              <ZAxis type="number" dataKey="track_count" range={[28, 220]} />
              <ReferenceLine x={xMedian} stroke={colors.muted} strokeDasharray="4 4" />
              <ReferenceLine y={yMedian} stroke={colors.muted} strokeDasharray="4 4" />
              <Tooltip content={<MomentumTooltip />} cursor={{ strokeDasharray: "3 3" }} />
              <Scatter data={scatterRows} fillOpacity={0.72} isAnimationActive={false}>
                {scatterRows.map((row) => {
                  const labelKey = row.label_keys[0] ?? "";
                  const label = labelByKey.get(labelKey);
                  const labelIndex = Math.max(0, labels.findIndex((candidate) => candidate.label_key === labelKey));
                  const accent = label ? labelColor(label, labelIndex) : colors.accent;
                  return <Cell key={row.artist_id} fill={accent} stroke={accent} />;
                })}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {labels.map((label, index) => (
            <span key={label.label_key} className="inline-flex items-center gap-1.5 text-[10px]" style={{ color: colors.muted }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: labelColor(label, index) }} />
              {label.display_name}
            </span>
          ))}
        </div>
      </section>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)]">
        <section className="sb-card min-w-0 overflow-hidden">
          <div className="border-b px-4 py-3" style={{ borderColor: colors.border }}>
            <h2 className="text-sm font-semibold">Artist momentum</h2>
            <p className="mt-1 text-xs" style={{ color: colors.muted }}>Latest net daily streams across unique tracked ISRCs.</p>
          </div>
          <div className="divide-y" style={{ borderColor: colors.border }}>
            {leaderboard.map((artist, index) => (
              <div key={artist.artist_id} className="grid grid-cols-[24px_30px_minmax(0,1fr)_auto] items-center gap-2 px-4 py-2">
                <span className="font-mono text-[10px]" style={{ color: colors.muted }}>{index + 1}</span>
                {artist.image_url ? (
                  <PreviewableArtwork src={artist.image_url} alt="" width={30} height={30} className="h-[30px] w-[30px] rounded-full object-cover" label={artist.artist_name} />
                ) : <div className="h-[30px] w-[30px] rounded-full bg-white/10" />}
                <div className="min-w-0">
                  <Link href={`/artists/${encodeURIComponent(artist.artist_id)}`} className="block truncate text-xs font-medium sb-link-hover">{artist.artist_name}</Link>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {artist.label_keys.slice(0, 3).map((key, labelIndex) => {
                      const label = labelByKey.get(key);
                      const accent = label ? labelColor(label, labelIndex) : colors.muted;
                      return <span key={key} className="text-[9px]" style={{ color: accent }}>{label?.display_name ?? key}</span>;
                    })}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-xs font-semibold tabular-nums" style={{ color: artist.daily_streams >= 0 ? colors.positive : colors.error }}>{artist.daily_streams >= 0 ? "+" : ""}{formatInt(Math.round(artist.daily_streams))}</div>
                  <div className="text-[9px]" style={{ color: colors.muted }}>{formatInt(artist.track_count)} tracks</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="sb-card min-w-0 p-4">
          <div>
            <h2 className="text-sm font-semibold">Release cohorts</h2>
            <p className="mt-1 text-xs" style={{ color: colors.muted }}>
              Median current daily streams by release month and age as of {data?.data_date ?? "-"}.
            </p>
          </div>
          <div className="mt-4 overflow-x-auto">
            <div className="grid min-w-[430px] gap-1" style={{ gridTemplateColumns: "64px repeat(5, minmax(56px, 1fr))" }}>
              <div />
              {ageBands.map((band) => <div key={band} className="pb-1 text-center text-[9px]" style={{ color: colors.muted }}>{band}</div>)}
              {cohortMonths.map((month) => (
                <div key={month} className="contents">
                  <div className="flex items-center font-mono text-[9px]" style={{ color: colors.muted }}>{month}</div>
                  {ageBands.map((band) => {
                    const row = cohortLookup.get(`${month}|${band}`);
                    const value = row?.median_daily_streams ?? 0;
                    const intensity = Math.min(0.82, Math.max(0.08, Math.abs(value) / maxCohortDaily));
                    const fill = row
                      ? `color-mix(in srgb, ${value >= 0 ? colors.positive : colors.error} ${Math.round(intensity * 100)}%, transparent)`
                      : "var(--sb-row-hover)";
                    return (
                      <div
                        key={`${month}-${band}`}
                        className="flex h-10 items-center justify-center rounded-sm font-mono text-[9px] tabular-nums"
                        style={{ background: fill, color: row ? colors.text : colors.muted }}
                        title={row ? `${month}, ${band}: median ${formatInt(Math.round(value))} daily streams across ${formatInt(row.track_count)} tracks` : `${month}, ${band}: no tracks`}
                      >
                        {row ? formatKmbTick(value) : "-"}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between text-[9px]" style={{ color: colors.muted }}>
            <span>Lower</span>
            <div className="mx-3 flex flex-1 gap-1">
              {[16, 34, 52, 70, 88].map((opacity) => (
                <span
                  key={opacity}
                  className="h-1.5 flex-1 rounded-sm"
                  style={{ background: `color-mix(in srgb, ${colors.positive} ${opacity}%, transparent)` }}
                />
              ))}
            </div>
            <span>Higher median daily</span>
          </div>
        </section>
      </div>
    </div>
  );
}
