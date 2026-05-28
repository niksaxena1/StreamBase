"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { GlassTable, TableCell, TableRow } from "@/components/ui/GlassTable";
import { PreviewableArtwork } from "@/components/ui/PreviewableArtwork";
import { Chip, ChipGroup } from "@/components/ui/Chip";
import { ArtistLinks } from "@/components/ui/ArtistLinks";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { fetchApiJson } from "@/lib/api";
import { formatInt } from "@/lib/format";
import { isAllCompetitorsKey } from "@/lib/competitorContext";
import { addDaysISO } from "@/lib/sotDates";
import type { CompetitorsIntelPayload } from "@/lib/competitors/parseCompetitorsIntel";

import { useCompetitorStreamMetric } from "./competitorStreamMetric";
import type {
  ChurnRow,
  LabelRow,
  MoverFilter,
  MoverTrackRow,
  OverlapCell,
} from "./competitorsTypes";
import { buildOwnOverlapLookup } from "@/lib/competitors/ownCatalog";

import { buildOverlapArtistLookup, buildOverlapLookup, deltaColor, labelColor } from "./competitorsUtils";

const CompetitorsOverlapMatrix = dynamic(
  () => import("./CompetitorsOverlapMatrix").then((m) => ({ default: m.CompetitorsOverlapMatrix })),
  {
    loading: () => <TableSkeleton rows={4} cols={4} />,
    ssr: false,
  },
);

function LabelBadge({ labelKey, labels }: { labelKey: string; labels: LabelRow[] }) {
  const label = labels.find((l) => l.label_key === labelKey);
  const idx = labels.findIndex((l) => l.label_key === labelKey);
  if (!label) return <span className="text-[10px] opacity-60">{labelKey}</span>;
  const color = labelColor(label, idx >= 0 ? idx : 0);
  return (
    <span
      className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium"
      style={{ background: `color-mix(in srgb, ${color} 22%, transparent)`, color }}
    >
      {label.display_name}
    </span>
  );
}

function filterMovers(
  rows: MoverTrackRow[],
  filter: MoverFilter,
  selectedLabelKey: string | null,
): MoverTrackRow[] {
  if (
    filter === "selected" &&
    selectedLabelKey &&
    !isAllCompetitorsKey(selectedLabelKey)
  ) {
    return rows.filter((r) => (r.label_keys ?? []).includes(selectedLabelKey));
  }
  return rows;
}

function intelUrl(args: {
  latestRunDate: string;
  latestDataDate: string;
  weekAgoDataDate: string;
  churnWindow: number;
  scope: "full" | "churn";
}) {
  const q = new URLSearchParams({
    run_date: args.latestRunDate,
    data_date: args.latestDataDate,
    week_ago_data_date: args.weekAgoDataDate,
    churn_window: String(args.churnWindow),
    scope: args.scope,
  });
  return `/api/competitors/intel?${q.toString()}`;
}

export function CompetitorsIntelSections(props: {
  labels: LabelRow[];
  latestDataDate: string;
  latestRunDate: string;
  selectedCompetitorLabelKey: string | null;
}) {
  const streamMetric = useCompetitorStreamMetric();
  const activeLabels = useMemo(() => props.labels.filter((l) => l.is_active !== false), [props.labels]);
  const canCompare = activeLabels.length >= 2;
  const weekAgoDataDate = addDaysISO(props.latestDataDate, -7);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const prefetchStarted = useRef(false);
  const [moverFilter, setMoverFilter] = useState<MoverFilter>("selected");
  const [churnWindow, setChurnWindow] = useState<7 | 30>(7);
  const [initialLoading, setInitialLoading] = useState(false);
  const [churnLoading, setChurnLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [intel, setIntel] = useState<CompetitorsIntelPayload | null>(null);
  const initialLoaded = useRef(false);
  const lastChurnWindow = useRef<7 | 30 | null>(null);

  useEffect(() => {
    if (prefetchStarted.current) return;
    prefetchStarted.current = true;

    const start = () => setShouldLoad(true);
    if (typeof requestIdleCallback !== "undefined") {
      const id = requestIdleCallback(start, { timeout: 2000 });
      return () => cancelIdleCallback(id);
    }
    const timer = window.setTimeout(start, 400);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (shouldLoad) return;
    const node = rootRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px 0px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [shouldLoad]);

  const loadFullIntel = useCallback(async () => {
    setInitialLoading(true);
    setError(null);
    try {
      const data = await fetchApiJson<CompetitorsIntelPayload>(
        intelUrl({
          latestRunDate: props.latestRunDate,
          latestDataDate: props.latestDataDate,
          weekAgoDataDate,
          churnWindow,
          scope: "full",
        }),
      );
      setIntel(data);
      initialLoaded.current = true;
      lastChurnWindow.current = churnWindow;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setIntel(null);
      initialLoaded.current = false;
      lastChurnWindow.current = null;
    } finally {
      setInitialLoading(false);
    }
  }, [churnWindow, props.latestDataDate, props.latestRunDate, weekAgoDataDate]);

  useEffect(() => {
    if (!shouldLoad || initialLoaded.current) return;
    void loadFullIntel();
  }, [shouldLoad, loadFullIntel]);

  useEffect(() => {
    if (!shouldLoad || !initialLoaded.current) return;
    if (lastChurnWindow.current === churnWindow) return;

    let cancelled = false;
    setChurnLoading(true);

    void (async () => {
      try {
        const data = await fetchApiJson<{ churn: ChurnRow[] }>(
          intelUrl({
            latestRunDate: props.latestRunDate,
            latestDataDate: props.latestDataDate,
            weekAgoDataDate,
            churnWindow,
            scope: "churn",
          }),
        );
        if (!cancelled) {
          setIntel((prev) =>
            prev
              ? { ...prev, churn: data.churn }
              : {
                  gainers: [],
                  losers: [],
                  churn: data.churn,
                  overlapCells: [],
                  overlapArtistCells: [],
                  ownOverlapCells: [],
                  ownOverlapArtistCells: [],
                },
          );
          lastChurnWindow.current = churnWindow;
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setChurnLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [churnWindow, props.latestDataDate, props.latestRunDate, shouldLoad, weekAgoDataDate]);

  const filteredGainers = useMemo(
    () => filterMovers(intel?.gainers ?? [], moverFilter, props.selectedCompetitorLabelKey),
    [intel?.gainers, moverFilter, props.selectedCompetitorLabelKey],
  );
  const filteredLosers = useMemo(
    () => filterMovers(intel?.losers ?? [], moverFilter, props.selectedCompetitorLabelKey),
    [intel?.losers, moverFilter, props.selectedCompetitorLabelKey],
  );
  const churnRows: ChurnRow[] = intel?.churn ?? [];
  const overlapCells: OverlapCell[] = intel?.overlapCells ?? [];
  const overlapArtistCells = intel?.overlapArtistCells ?? [];
  const overlapLookup = useMemo(() => buildOverlapLookup(overlapCells), [overlapCells]);
  const overlapArtistLookup = useMemo(
    () => buildOverlapArtistLookup(overlapArtistCells),
    [overlapArtistCells],
  );
  const ownOverlapLookup = useMemo(
    () => buildOwnOverlapLookup(intel?.ownOverlapCells ?? []),
    [intel?.ownOverlapCells],
  );
  const ownOverlapArtistLookup = useMemo(
    () => buildOwnOverlapLookup(intel?.ownOverlapArtistCells ?? []),
    [intel?.ownOverlapArtistCells],
  );
  if (!shouldLoad) {
    return (
      <div ref={rootRef} className="min-h-[120px]" aria-hidden="true" />
    );
  }

  if (initialLoading && !intel) {
    return (
      <div ref={rootRef} className="space-y-6">
        <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
          Loading competitive intel…
        </div>
        <TableSkeleton rows={8} cols={5} />
        <TableSkeleton rows={4} cols={5} />
      </div>
    );
  }

  if (error && !intel) {
    return (
      <div ref={rootRef} className="sb-card p-4 text-sm" style={{ color: "var(--sb-muted)" }}>
        Could not load competitive intel: {error}
      </div>
    );
  }

  return (
    <div ref={rootRef} className="space-y-6">
      {(intel?.gainers.length || intel?.losers.length) ? (
        <div className="sb-card p-4 space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <div className="text-xs font-medium uppercase tracking-wider opacity-60">Top movers</div>
              <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
                Cross-competitor tracks on latest data date
              </div>
            </div>
            <ChipGroup segmented>
              {(["selected", "all"] as const).map((f) => (
                <Chip key={f} segmented selected={moverFilter === f} onClick={() => setMoverFilter(f)}>
                  {f === "selected" ? "Selected" : "All"}
                </Chip>
              ))}
            </ChipGroup>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {(
              [
                ["Gainers", filteredGainers],
                ["Losers", filteredLosers],
              ] as const
            ).map(([title, rows]) => (
              <div key={title}>
                <div className="mb-2 text-xs font-medium">{title}</div>
                <GlassTable
                  headers={[
                    "",
                    "Track",
                    "Labels",
                    streamMetric.dailyColumnLabel,
                    streamMetric.displayMetric === "revenue" ? "Total rev" : "Total",
                  ]}
                >
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-xs opacity-60">
                        No tracks in this filter.
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((track) => (
                      <TableRow key={`${title}-${track.isrc}`}>
                        <TableCell>
                          {track.album_image_url ? (
                            <PreviewableArtwork
                              src={track.album_image_url}
                              alt=""
                              width={32}
                              height={32}
                              className="h-8 w-8 rounded object-cover sb-ring"
                              label={track.name}
                            />
                          ) : (
                            <div className="h-8 w-8 rounded bg-white/10 sb-ring" />
                          )}
                        </TableCell>
                        <TableCell>
                          <Link
                            href={`/tracks/${encodeURIComponent(track.isrc)}`}
                            className="font-medium transition-colors sb-link-hover"
                          >
                            {track.name}
                          </Link>
                          <div className="truncate text-[10px] opacity-60">
                            <ArtistLinks
                              artistNames={track.artist_names}
                              artistIds={track.artist_ids}
                            />
                            {!track.artist_names?.length ? "—" : null}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {(track.label_keys ?? []).map((lk) => (
                              <LabelBadge key={lk} labelKey={lk} labels={props.labels} />
                            ))}
                          </div>
                        </TableCell>
                        <TableCell numeric style={streamMetric.valueStyle}>
                          {streamMetric.formatDelta(track.daily_delta) ?? "—"}
                        </TableCell>
                        <TableCell numeric style={streamMetric.valueStyle}>
                          {streamMetric.format(track.total)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </GlassTable>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {churnRows.length > 0 || churnLoading ? (
        <div className="sb-card p-4 space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <div className="text-xs font-medium uppercase tracking-wider opacity-60">Catalog churn</div>
              <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
                Playlist membership adds and removals
                {churnLoading ? " · updating…" : ""}
              </div>
            </div>
            <ChipGroup segmented>
              <Chip
                segmented
                selected={churnWindow === 7}
                onClick={() => setChurnWindow(7)}
                disabled={churnLoading}
              >
                7d
              </Chip>
              <Chip
                segmented
                selected={churnWindow === 30}
                onClick={() => setChurnWindow(30)}
                disabled={churnLoading}
              >
                30d
              </Chip>
            </ChipGroup>
          </div>
          {churnLoading && churnRows.length === 0 ? (
            <TableSkeleton rows={4} cols={5} />
          ) : (
            <GlassTable headers={["Label", "Added", "Removed", "Net", "Track count Δ (7d)"]}>
              {churnRows.map((churn) => {
                const label = props.labels.find((l) => l.label_key === churn.label_key);
                const trackDelta = churn.track_count_delta_7d;
                return (
                  <TableRow key={churn.label_key}>
                    <TableCell>{label?.display_name ?? churn.label_key}</TableCell>
                    <TableCell numeric className="text-lime-600 dark:text-lime-400">
                      +{formatInt(churn.added_count)}
                    </TableCell>
                    <TableCell numeric className="text-red-500">
                      {churn.removed_count > 0 ? `-${formatInt(churn.removed_count)}` : formatInt(0)}
                    </TableCell>
                    <TableCell numeric style={{ color: deltaColor(churn.net) }}>
                      {churn.net > 0 ? "+" : ""}
                      {formatInt(churn.net)}
                    </TableCell>
                    <TableCell numeric>
                      {trackDelta == null ? (
                        "—"
                      ) : (
                        <span style={{ color: deltaColor(trackDelta) }}>
                          {trackDelta > 0 ? "+" : ""}
                          {formatInt(trackDelta)}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </GlassTable>
          )}
        </div>
      ) : null}

      {canCompare ? (
        <CompetitorsOverlapMatrix
          activeLabels={activeLabels}
          overlapLookup={overlapLookup}
          overlapArtistLookup={overlapArtistLookup}
          ownOverlapLookup={ownOverlapLookup}
          ownOverlapArtistLookup={ownOverlapArtistLookup}
          latestRunDate={props.latestRunDate}
        />
      ) : null}
    </div>
  );
}
