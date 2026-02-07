"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";

import { extractOverrideItemsFromRechartsPayload, formatTooltipDateDaily } from "@/components/charts/chartUtils";
import { ViewportAwareTooltip } from "@/components/charts/ViewportAwareTooltip";
import type { TooltipCopyValues } from "@/components/charts/useChartCopyToClipboard";

type TooltipPayloadEntry = {
  value?: unknown;
  dataKey?: unknown;
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
}: {
  active?: boolean;
  label?: string;
  payload?: TooltipPayloadEntry[];
  valueLabel: string;
  fmtValue: (n: number) => string;
  isDark: boolean;
  chartColor: string;
  onValuesFormatted?: (v: TooltipCopyValues) => void;
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

  useEffect(() => {
    if (!active) return;
    if (!mainValueFormatted) return;
    const key = `${label ?? ""}||${mainValueFormatted}||${ma7ValueFormatted ?? ""}`;
    if (key === lastSentKeyRef.current) return;
    lastSentKeyRef.current = key;
    onValuesFormatted?.({ label: label ?? null, main: mainValueFormatted, ma7: ma7ValueFormatted });
  }, [active, label, mainValueFormatted, ma7ValueFormatted, onValuesFormatted]);

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
        {label ? <div className="mb-2 text-xs font-medium">{formatTooltipDateDaily(label)}</div> : null}

        {sorted.map((entry, index) => {
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

          return (
            <div key={index} className="text-xs">
              <span style={{ color: "var(--sb-text)" }}>
                {seriesLabel}:{" "}
                <span className="font-bold" style={{ color: valueColor }}>
                  {value}
                </span>
              </span>
            </div>
          );
        })}

        {overrideItems?.length ? (
          <div className="mt-2 border-t pt-2" style={{ borderColor: "var(--sb-border)" }}>
            <div className="text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--sb-warning)" }}>
              Manual override
            </div>
            <div className="mt-1 space-y-1">
              {overrideItems.map((it, idx) => (
                <div key={idx} className="flex items-start gap-2">
                  {it.imageUrl ? (
                    <Image src={it.imageUrl} alt="" width={32} height={32} className="h-8 w-8 rounded-md object-cover sb-ring" />
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

