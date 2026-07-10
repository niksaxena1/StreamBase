"use client";

import { useEffect, useRef } from "react";

import { extractOverrideItemsFromRechartsPayload, extractWeekendDipFromRechartsPayload, formatTooltipDateSmart } from "@/components/charts/chartUtils";
import { ViewportAwareTooltip } from "@/components/charts/ViewportAwareTooltip";
import { PreviewableArtwork } from "@/components/ui/PreviewableArtwork";
import type { TooltipCopyValues } from "@/components/charts/useChartCopyToClipboard";
import { formatInt } from "@/lib/format";

function formatFollowerDeltaDisplay(value: number, isBaseline?: boolean) {
  if (isBaseline) return "0";
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatInt(value)}`;
}

/** Plain integer for clipboard (no thousands separators or + prefix). */
function formatFollowerDeltaCopy(value: number, isBaseline?: boolean) {
  if (isBaseline) return "0";
  return String(Math.trunc(value));
}

function formatFollowerTotalCopy(value: number) {
  return String(Math.trunc(value));
}

function followerDailyTooltipColor(
  daily: number,
  isBaseline: boolean,
  isActive: boolean,
  isDark: boolean,
  chartColor: string,
) {
  if (!isBaseline && daily < 0) return "var(--sb-error, #ef4444)";
  if (isActive) return isDark ? chartColor : "var(--sb-text)";
  return "var(--sb-muted)";
}

function followerMetricsFromPayload(payload: Record<string, unknown> | undefined) {
  if (!payload) return null;
  const total = Number(payload._followersTotal);
  const daily = Number(payload._followersDaily);
  if (!Number.isFinite(total) || !Number.isFinite(daily)) return null;
  return {
    total,
    daily,
    isBaseline: Boolean(payload._isBaselineDay),
  };
}

type TooltipPayloadEntry = {
  value?: unknown;
  dataKey?: unknown;
  payload?: Record<string, unknown>;
};

export function DailySeriesTooltip({
  active,
  label,
  payload,
  valueLabel,
  fmtValue,
  isDark,
  chartColor,
  onValuesFormatted,
  isCumulative,
}: {
  active?: boolean;
  label?: string;
  payload?: TooltipPayloadEntry[];
  valueLabel: string;
  fmtValue: (n: number) => string;
  isDark: boolean;
  chartColor: string;
  onValuesFormatted?: (v: TooltipCopyValues) => void;
  isCumulative?: boolean;
}) {
  // Avoid update loops by only notifying when values change.
  const lastSentKeyRef = useRef<string>("");

  const safePayload = payload ?? [];
  const toNum = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  // Sort payload: main series first, then ma7
  const sorted = safePayload.length
    ? [...safePayload].sort((a, b) => {
        const aIsMA = String(a?.dataKey ?? "") === "ma7";
        const bIsMA = String(b?.dataKey ?? "") === "ma7";
        if (aIsMA && !bIsMA) return 1;
        if (!aIsMA && bIsMA) return -1;
        return 0;
      })
    : [];

  const mainValue = sorted[0];
  const mainValueNum = mainValue ? toNum(mainValue.value) : null;
  const mainValueFormatted = mainValueNum == null ? null : fmtValue(mainValueNum);
  const maEntry = sorted.find((e) => String(e?.dataKey ?? "") === "ma7");
  const ma7Num = maEntry ? toNum(maEntry.value) : null;
  const ma7ValueFormatted = ma7Num == null ? null : fmtValue(Math.round(ma7Num));
  const overrideItems = extractOverrideItemsFromRechartsPayload(safePayload);
  const weekendDipPct = extractWeekendDipFromRechartsPayload(safePayload);
  const followerMetrics = followerMetricsFromPayload(sorted[0]?.payload as Record<string, unknown> | undefined);

  const copyValues: TooltipCopyValues | null = (() => {
    if (!mainValueFormatted && !followerMetrics) return null;
    if (followerMetrics) {
      if (isCumulative) {
        return {
          label: label ?? null,
          main: formatFollowerTotalCopy(followerMetrics.total),
          ma7: ma7ValueFormatted,
          toastMessage: "Copied total followers to clipboard",
        };
      }
      return {
        label: label ?? null,
        main: formatFollowerDeltaCopy(followerMetrics.daily, followerMetrics.isBaseline),
        ma7: ma7ValueFormatted,
        toastMessage: "Copied daily followers to clipboard",
      };
    }
    return {
      label: label ?? null,
      main: mainValueFormatted ?? "",
      ma7: ma7ValueFormatted,
    };
  })();

  useEffect(() => {
    if (!active) return;
    if (!copyValues?.main) return;
    const key = `${label ?? ""}||${copyValues.main}||${copyValues.ma7 ?? ""}||${copyValues.toastMessage ?? ""}`;
    if (key === lastSentKeyRef.current) return;
    lastSentKeyRef.current = key;
    onValuesFormatted?.(copyValues);
  }, [active, label, copyValues, onValuesFormatted]);

  if (!active || sorted.length === 0) return null;

  return (
    <ViewportAwareTooltip>
      <div
        className="rounded-lg border p-3 max-h-[60vh] overflow-auto"
        style={{
          backgroundColor: "var(--sb-card)",
          borderColor: "var(--sb-border)",
          boxShadow: "var(--sb-shadow-compact)",
          color: "var(--sb-text)",
        }}
      >
        {label ? <div className="mb-2 text-xs font-medium">{formatTooltipDateSmart(label)}</div> : null}

        {Boolean(sorted[0]?.payload?._isPartial) && (
          <div
            className="mb-1.5 rounded px-1.5 py-0.5 text-[10px] font-medium"
            style={{ backgroundColor: "var(--sb-surface)", color: "var(--sb-muted)" }}
          >
            Partial period{(() => {
              const days = Number(sorted[0]?.payload?._bucketDays);
              return days > 0 ? ` · ${days} day${days !== 1 ? "s" : ""}` : "";
            })()}
          </div>
        )}

        {Boolean(sorted[0]?.payload?._isBaselineDay) && (
          <div
            className="mb-1.5 rounded px-1.5 py-0.5 text-[10px] font-medium"
            style={{ backgroundColor: "var(--sb-surface)", color: "var(--sb-muted)" }}
          >
            First snapshot — daily change starts the next day
          </div>
        )}

        {followerMetrics ? (
          <div className="space-y-1 text-xs">
            <div>
              <span style={{ color: "var(--sb-muted)" }}>Daily change: </span>
              <span
                className="font-bold"
                style={{
                  color: followerDailyTooltipColor(
                    followerMetrics.daily,
                    followerMetrics.isBaseline,
                    !isCumulative,
                    isDark,
                    chartColor,
                  ),
                }}
              >
                {formatFollowerDeltaDisplay(followerMetrics.daily, followerMetrics.isBaseline)}
              </span>
            </div>
            <div>
              <span style={{ color: "var(--sb-muted)" }}>Total followers: </span>
              <span
                className="font-bold"
                style={{ color: isCumulative ? (isDark ? chartColor : "var(--sb-text)") : "var(--sb-muted)" }}
              >
                {formatInt(followerMetrics.total)}
              </span>
            </div>
          </div>
        ) : (
          sorted.map((entry, index) => {
            const isMA = String(entry?.dataKey ?? "") === "ma7";
            const seriesLabel = isMA ? "MA (7d)" : valueLabel;
            const raw = toNum(entry.value);
            const value = isMA
              ? raw == null
                ? "—"
                : fmtValue(Math.round(raw))
              : raw == null
                ? "—"
                : fmtValue(raw);

            const valueColor = isDark ? chartColor : "var(--sb-text)";

            const bucketDays = Number(entry?.payload?._bucketDays);
            const showAvg = !isMA && !isCumulative && raw != null && bucketDays > 1;
            const growthPct = !isMA && !isCumulative ? Number(entry?.payload?._growthPct) : NaN;
            const hasGrowth = Number.isFinite(growthPct);

            return (
              <div key={index} className="text-xs">
                <span style={{ color: "var(--sb-text)" }}>
                  {seriesLabel}:{" "}
                  <span className="font-bold" style={{ color: valueColor }}>
                    {value}
                  </span>
                  {hasGrowth && (
                    <span
                      className="ml-1.5 text-[10px] font-semibold"
                      style={{ color: growthPct > 0 ? "var(--sb-success, #10b981)" : growthPct < 0 ? "var(--sb-error, #ef4444)" : "var(--sb-muted)" }}
                    >
                      {growthPct > 0 ? "+" : ""}{growthPct.toFixed(1)}%
                    </span>
                  )}
                </span>
                {showAvg && (
                  <div className="text-[10px]" style={{ color: "var(--sb-muted)" }}>
                    avg: {fmtValue(Math.round(raw / bucketDays))}/day
                  </div>
                )}
              </div>
            );
          })
        )}

        {weekendDipPct != null && (
          <div
            className="text-xs mt-1.5 pt-1.5 border-t"
            style={{ borderColor: "var(--sb-border)" }}
          >
            <span style={{ color: "var(--sb-muted)" }}>
              vs weekday avg:{" "}
              <span className="font-semibold" style={{ color: "var(--sb-muted)" }}>
                {weekendDipPct > 0 ? "+" : ""}
                {weekendDipPct.toFixed(1)}%
              </span>
            </span>
          </div>
        )}

        {overrideItems?.length ? (
          <div className="mt-2 border-t pt-2" style={{ borderColor: "var(--sb-border)" }}>
            <div className="text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--sb-warning)" }}>
              Manual override
            </div>
            <div className="mt-1 space-y-1">
              {overrideItems.map((it, idx) => (
                <div key={idx} className="flex items-start gap-2">
                  {it.imageUrl ? (
                    <PreviewableArtwork src={it.imageUrl} alt="" width={32} height={32} className="h-8 w-8 rounded-md object-cover sb-ring" />
                  ) : (
                    <div className="h-8 w-8 rounded-md sb-ring bg-white/60 dark:bg-white/10" />
                  )}
                  <div className="min-w-0">
                    {it.title ? (
                      <div className="text-xs font-medium truncate" style={{ color: "var(--sb-text)" }}>
                        {it.title}
                      </div>
                    ) : null}
                    <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
                      {it.note}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </ViewportAwareTooltip>
  );
}

