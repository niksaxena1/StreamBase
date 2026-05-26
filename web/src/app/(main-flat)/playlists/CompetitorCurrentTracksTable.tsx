"use client";

import { PreviewableArtwork } from "@/components/ui/PreviewableArtwork";
import Link from "next/link";
import { useMemo, useState } from "react";

import { useMetric } from "@/components/metrics/MetricContext";
import { usePayoutRate } from "@/components/payout/PayoutRateContext";
import { formatDateISO, formatInt, formatUsd } from "@/lib/format";

export type CompetitorCurrentTrackRow = {
  isrc: string;
  name: string;
  album_image_url: string | null;
  artist_names: string[] | null;
  artist_ids?: string[] | null;
  release_date?: string | null;
  total: number | null;
  daily?: number | null;
};

type SortKey = "track" | "release" | "total" | "daily";
type SortState = { key: SortKey; asc: boolean } | null;

function compareNullableNumber(a: number | null | undefined, b: number | null | undefined) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a - b;
}

function compareNullableDate(a: string | null | undefined, b: string | null | undefined) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b);
}

function SortHeader(props: {
  label: string;
  active: boolean;
  asc: boolean;
  align?: "left" | "right";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={[
        "inline-flex items-center gap-1 transition-opacity hover:opacity-100",
        props.align === "right" ? "justify-end" : "",
      ].join(" ")}
    >
      <span>{props.label}</span>
      {props.active ? <span>{props.asc ? "↑" : "↓"}</span> : null}
    </button>
  );
}

export function CompetitorCurrentTracksTable({ rows }: { rows: CompetitorCurrentTrackRow[] }) {
  const { metric } = useMetric();
  const { streamPayoutPerStreamUsd } = usePayoutRate();
  const [sort, setSort] = useState<SortState>({ key: "total", asc: false });

  const displayMode = metric === "revenue" ? "revenue" : "streams";
  const numberStyle =
    displayMode === "revenue"
      ? ({ color: "#10b981" } as const)
      : ({ color: "var(--sb-positive)" } as const);
  const sortedRows = useMemo(() => {
    const next = [...rows];
    if (!sort) return next;
    next.sort((a, b) => {
      let cmp = 0;
      if (sort.key === "track") cmp = a.name.localeCompare(b.name);
      if (sort.key === "release") cmp = compareNullableDate(a.release_date, b.release_date);
      if (sort.key === "total") {
        if (a.total == null || b.total == null) return compareNullableNumber(a.total, b.total);
        cmp = a.total - b.total;
      }
      if (sort.key === "daily") {
        if (a.daily == null || b.daily == null) return compareNullableNumber(a.daily, b.daily);
        cmp = a.daily - b.daily;
      }
      return sort.asc ? cmp : -cmp;
    });
    return next;
  }, [rows, sort]);

  function toggleSort(key: SortKey, defaultAsc: boolean) {
    setSort((current) =>
      current?.key === key ? { key, asc: !current.asc } : { key, asc: defaultAsc },
    );
  }

  function formatMetric(value: number | null | undefined, daily = false) {
    if (value == null) return "—";
    const metricValue = displayMode === "revenue" ? value * streamPayoutPerStreamUsd : value;
    const formatted = displayMode === "revenue" ? formatUsd(metricValue) : formatInt(metricValue);
    return daily && value > 0 ? `+${formatted}` : formatted;
  }

  return (
    <div className="sb-card overflow-x-auto">
      <div className="min-w-[680px]">
      <div className="grid grid-cols-[minmax(220px,1fr)_110px_120px_120px] gap-3 border-b px-4 py-3 text-xs font-medium uppercase tracking-wider opacity-60"
        style={{ borderColor: "var(--sb-border)" }}
      >
        <SortHeader label="Track" active={sort?.key === "track"} asc={sort?.asc ?? true} onClick={() => toggleSort("track", true)} />
        <SortHeader label="Release" active={sort?.key === "release"} asc={sort?.asc ?? false} onClick={() => toggleSort("release", false)} />
        <SortHeader label={displayMode === "revenue" ? "Total revenue" : "Total streams"} active={sort?.key === "total"} asc={sort?.asc ?? false} align="right" onClick={() => toggleSort("total", false)} />
        <SortHeader label={displayMode === "revenue" ? "Daily revenue" : "Daily streams"} active={sort?.key === "daily"} asc={sort?.asc ?? false} align="right" onClick={() => toggleSort("daily", false)} />
      </div>

      <div className="max-h-[560px] overflow-auto">
        {sortedRows.slice(0, 100).map((row) => (
          <div key={row.isrc} className="grid grid-cols-[minmax(220px,1fr)_110px_120px_120px] items-center gap-3 px-4 py-2 text-sm">
            <div className="flex min-w-0 items-center gap-3">
              {row.album_image_url ? (
                <PreviewableArtwork src={row.album_image_url} alt={row.name} width={32} height={32} className="h-8 w-8 rounded-lg object-cover sb-ring" label={row.name} />
              ) : (
                <div className="h-8 w-8 rounded-lg bg-white/10 sb-ring" />
              )}
              <div className="min-w-0">
                <Link href={`/catalog?isrc=${encodeURIComponent(row.isrc)}`} className="block truncate font-medium transition-colors sb-link-hover">
                  {row.name}
                </Link>
                <div className="truncate text-xs opacity-60">
                  {(row.artist_names ?? []).map((artistName, idx) => {
                    const artistId = row.artist_ids?.[idx];
                    return (
                      <span key={`${row.isrc}-${artistId ?? artistName}-${idx}`}>
                        {idx > 0 ? ", " : null}
                        {artistId ? <Link href={`/catalog?artist_id=${encodeURIComponent(artistId)}`} className="transition-colors sb-link-hover">{artistName}</Link> : artistName}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="font-mono text-xs opacity-70">{row.release_date ? formatDateISO(row.release_date) : "—"}</div>
            <div className="text-right font-mono text-xs font-medium" style={numberStyle}>{formatMetric(row.total)}</div>
            <div
              className="text-right font-mono text-xs font-medium"
              style={
                row.daily != null && row.daily < 0
                  ? { color: "var(--sb-negative)" }
                  : numberStyle
              }
            >
              {formatMetric(row.daily, true)}
            </div>
          </div>
        ))}
      </div>
      </div>
    </div>
  );
}
