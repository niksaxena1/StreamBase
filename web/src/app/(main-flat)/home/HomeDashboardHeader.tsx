"use client";

import Link from "next/link";
import { useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Music } from "lucide-react";
import { PreviewableArtwork } from "@/components/ui/PreviewableArtwork";
import { PlaylistReportDownload } from "@/components/dashboard/PlaylistReportDownload";
import { competitorLabelThumbObjectPosition } from "@/lib/competitorLabelThumbFit";
import { cx } from "@/lib/cx";
import { formatInt } from "@/lib/format";
import { hrefWithPatchedSearchParams } from "@/lib/searchParams";
import { useSharedGranularity } from "@/lib/useSharedGranularity";
import { GranularitySelect, RangeSelect, handleGranularityWithRangeRestore, type Granularity } from "@/components/ui/GranularitySelect";
import { DateRangePicker, type DateRangePickerHandle } from "@/components/ui/DateRangePicker";
import type { HomeDashboardServerProps } from "./homeTypes";

export type HomeHeaderProps = Pick<HomeDashboardServerProps,
  "sp" | "datasetMode" | "playlistKey" | "playlistImageUrl" | "competitorLabelKey" | "title" | "latestDataDate" | "latest" | "rangeDays" | "legacyHistoryEnabled">;

function hrefWith(
  existing: { scope?: string; range?: string; daily?: string; xy_date?: string; start?: string; end?: string; legacy?: string },
  patch: { scope?: string; range?: string; daily?: string; xy_date?: string | null; start?: string | null; end?: string | null; legacy?: string | null },
) {
  const scope = (patch.scope ?? existing.scope ?? "all_catalog").toString();
  const range = (patch.range ?? existing.range ?? "30").toString();
  const daily = (patch.daily ?? existing.daily ?? "").toString();
  const xy_date =
    patch.xy_date === null ? null : (patch.xy_date ?? existing.xy_date ?? null);
  const start = patch.start === null ? null : (patch.start ?? existing.start ?? null);
  const end = patch.end === null ? null : (patch.end ?? existing.end ?? null);
  const legacy = patch.legacy === null ? null : (patch.legacy ?? existing.legacy ?? null);
  return hrefWithPatchedSearchParams("", { scope, range, daily, xy_date, start, end, legacy }, { prefix: "/?" });
}

function ToggleLink(props: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={props.href}
      className={[
        "rounded-full px-2.5 py-1.5 text-[11px] font-medium transition",
        props.active
          ? "bg-black text-white dark:bg-white dark:text-black"
          : "text-black/70 hover:bg-white/70 dark:text-white/70 dark:hover:bg-white/20",
      ].join(" ")}
    >
      {props.children}
    </Link>
  );
}

export function HomeDashboardHeader(props: HomeHeaderProps) {
  const [granularity, setGranularityRaw] = useSharedGranularity("sb:home:granularity");
  const router = useRouter();
  const datePickerRef = useRef<DateRangePickerHandle>(null);
  const hasCustomRange = Boolean(props.sp.start && props.sp.end);
  const pushRange = useCallback(
    (range: number) => router.push(hrefWith(props.sp, { range: String(range) })),
    [router, props.sp],
  );
  const handleGranularityChange = useCallback(
    (g: Granularity) =>
      handleGranularityWithRangeRestore(g, props.rangeDays, "home", setGranularityRaw, pushRange),
    [props.rangeDays, setGranularityRaw, pushRange],
  );

  return (
<div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            {props.playlistImageUrl ? (
              <PreviewableArtwork
                src={props.playlistImageUrl}
                alt={props.datasetMode === "competitor" ? `${props.title} cover` : "Playlist cover"}
                width={40}
                height={40}
                className={cx(
                  "h-10 w-10 object-cover sb-ring",
                  props.datasetMode === "competitor" ? "rounded-full" : "rounded-lg",
                )}
                objectPosition={
                  props.datasetMode === "competitor"
                    ? competitorLabelThumbObjectPosition(props.competitorLabelKey)
                    : undefined
                }
              />
            ) : props.playlistKey === "all_catalog" ? (
              <div
                className="sb-ring flex h-10 w-10 items-center justify-center rounded-lg"
                style={{ background: "var(--sb-accent)" }}
              >
                <Music className="h-5 w-5" style={{ color: "black" }} />
              </div>
            ) : (
              <div className="h-10 w-10 rounded-lg sb-ring bg-white/60" />
            )}
            <div className="flex items-center gap-2">
              <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
                {props.title}
              </h1>
              {props.datasetMode === "own" ? (
                <PlaylistReportDownload latestDate={props.latestDataDate ?? null} />
              ) : null}
              {props.latest?.track_count !== null && props.latest?.track_count !== undefined && (
                <span
                  className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-wide"
                  style={{
                    borderColor: "var(--sb-border)",
                    backgroundColor: "var(--sb-surface)",
                    color: "var(--sb-muted)",
                  }}
                >
                  {formatInt(props.latest.track_count)} tracks
                </span>
              )}
            </div>
          </div>
          <p className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
            {props.datasetMode === "competitor"
              ? "Overview of the selected competitor across its tracked playlists."
              : "Overview of your catalog performance across all playlists."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {props.datasetMode === "own" ? (
            <div className="sb-ring flex items-center gap-0.5 rounded-full bg-white/60 p-0.5 dark:bg-white/10">
              <ToggleLink active={props.playlistKey === "all_catalog"} href={hrefWith(props.sp, { scope: "all_catalog" })}>All</ToggleLink>
              <ToggleLink active={props.playlistKey === "releases"} href={hrefWith(props.sp, { scope: "releases" })}>Releases</ToggleLink>
              <ToggleLink active={props.playlistKey === "ext"} href={hrefWith(props.sp, { scope: "ext" })}>Ext</ToggleLink>
            </div>
          ) : null}

          {props.datasetMode === "own" && props.playlistKey === "all_catalog" ? (
            <div
              className="sb-ring flex items-center rounded-full bg-white/60 p-0.5 dark:bg-white/10"
              title="Include recovered 2023–2025 Grafana history"
            >
              <ToggleLink
                active={props.legacyHistoryEnabled}
                href={hrefWith(props.sp, {
                  legacy: props.legacyHistoryEnabled ? null : "1",
                  range: props.legacyHistoryEnabled ? "365" : "1200",
                  start: null,
                  end: null,
                })}
              >
                Archived history
              </ToggleLink>
            </div>
          ) : null}

          {granularity === "daily" && (
            <>
              <RangeSelect
                value={props.rangeDays}
                onChange={pushRange}
                onCustom={() => datePickerRef.current?.open()}
                customActive={hasCustomRange}
                customStart={props.sp.start ?? null}
                customEnd={props.sp.end ?? null}
                archiveRangeDays={props.legacyHistoryEnabled ? 1200 : undefined}
              />
              <DateRangePicker ref={datePickerRef} latestDate={props.latestDataDate ?? null} currentRangeDays={props.rangeDays} headless />
            </>
          )}
          <GranularitySelect value={granularity} onChange={handleGranularityChange} />
        </div>
      </div>
  );
}
