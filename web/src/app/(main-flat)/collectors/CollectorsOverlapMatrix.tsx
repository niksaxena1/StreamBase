"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import { Chip, ChipGroup } from "@/components/ui/Chip";
import { fetchApiJson } from "@/lib/api";
import { formatInt } from "@/lib/format";
import { COLLECTOR_COLORS } from "@/components/charts/CollectorComparisonChart";

import { CompetitorOverlapArtistsModal } from "../competitors/CompetitorOverlapArtistsModal";
import { CompetitorOverlapTracksModal } from "../competitors/CompetitorOverlapTracksModal";
import type {
  CollectorOverlapArtistCell,
  CollectorOverlapArtistRow,
  CollectorOverlapBasis,
  CollectorOverlapCell,
  CollectorOverlapTrackRow,
} from "./collectorsTypes";
import { COLLECTOR_ORDER } from "./collectorsTypes";
import {
  buildOverlapArtistLookup,
  buildOverlapLookup,
  lookupOverlap,
  lookupOverlapArtist,
} from "../competitors/competitorsUtils";
import type { OverlapArtistCell, OverlapCell } from "../competitors/competitorsTypes";

type OverlapModalState = {
  collectorA: string;
  collectorB: string;
  sharedCount: number;
};

type OverlapValueMode = "count" | "percent";

function overlapTracksUrl(
  runDate: string,
  collectorA: string,
  collectorB: string,
  useEntityPlaylists: boolean,
) {
  const q = new URLSearchParams({
    run_date: runDate,
    collector_a: collectorA,
    collector_b: collectorB,
    use_entity_playlists: useEntityPlaylists ? "1" : "0",
  });
  return `/api/collectors/overlap-tracks?${q.toString()}`;
}

function overlapArtistsUrl(
  runDate: string,
  collectorA: string,
  collectorB: string,
  useEntityPlaylists: boolean,
) {
  const q = new URLSearchParams({
    run_date: runDate,
    collector_a: collectorA,
    collector_b: collectorB,
    use_entity_playlists: useEntityPlaylists ? "1" : "0",
  });
  return `/api/collectors/overlap-artists?${q.toString()}`;
}

function formatJaccardPercent(jaccard: number): string {
  const pct = Number(jaccard) * 100;
  if (!Number.isFinite(pct) || pct <= 0) return "0%";
  if (pct < 0.1) return "<0.1%";
  if (pct >= 10) return `${Math.round(pct)}%`;
  return `${pct.toFixed(1)}%`;
}

function toTrackOverlapCells(cells: CollectorOverlapCell[]): OverlapCell[] {
  return cells.map((c) => ({
    label_a: c.collector_a,
    label_b: c.collector_b,
    shared_isrcs: c.shared_isrcs,
    label_a_total: c.collector_a_total,
    label_b_total: c.collector_b_total,
    jaccard: c.jaccard,
  }));
}

function toArtistOverlapCells(cells: CollectorOverlapArtistCell[]): OverlapArtistCell[] {
  return cells.map((c) => ({
    label_a: c.collector_a,
    label_b: c.collector_b,
    shared_artists: c.shared_artists,
    label_a_total: c.collector_a_total,
    label_b_total: c.collector_b_total,
    jaccard: c.jaccard,
  }));
}

export function CollectorsOverlapMatrix(props: {
  overlapCells: CollectorOverlapCell[];
  overlapArtistCells: CollectorOverlapArtistCell[];
  latestRunDate: string;
  useEntityPlaylistsForTotals: boolean;
}) {
  const activeCollectors = useMemo(
    () => COLLECTOR_ORDER.map((collector) => ({ collector, color: COLLECTOR_COLORS[collector] })),
    [],
  );

  const overlapLookup = useMemo(
    () => buildOverlapLookup(toTrackOverlapCells(props.overlapCells)),
    [props.overlapCells],
  );
  const overlapArtistLookup = useMemo(
    () => buildOverlapArtistLookup(toArtistOverlapCells(props.overlapArtistCells)),
    [props.overlapArtistCells],
  );

  const [basis, setBasis] = useState<CollectorOverlapBasis>("artists");
  const [valueMode, setValueMode] = useState<OverlapValueMode>("count");
  const [modal, setModal] = useState<OverlapModalState | null>(null);
  const [tracks, setTracks] = useState<CollectorOverlapTrackRow[]>([]);
  const [artists, setArtists] = useState<CollectorOverlapArtistRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchGen = useRef(0);

  const closeModal = useCallback(() => {
    setModal(null);
    setTracks([]);
    setArtists([]);
    setError(null);
    setLoading(false);
    fetchGen.current += 1;
  }, []);

  const switchBasis = useCallback(
    (next: CollectorOverlapBasis) => {
      if (next === basis) return;
      closeModal();
      setBasis(next);
    },
    [basis, closeModal],
  );

  const openOverlap = useCallback(
    (collectorA: string, collectorB: string, sharedCount: number) => {
      if (sharedCount <= 0) return;

      setModal({ collectorA, collectorB, sharedCount });
      setTracks([]);
      setArtists([]);
      setError(null);
      setLoading(true);

      const gen = ++fetchGen.current;
      const request =
        basis === "tracks"
          ? fetchApiJson<{ tracks: CollectorOverlapTrackRow[] }>(
              overlapTracksUrl(
                props.latestRunDate,
                collectorA,
                collectorB,
                props.useEntityPlaylistsForTotals,
              ),
            ).then((data) => {
              if (fetchGen.current !== gen) return;
              setTracks(data.tracks ?? []);
            })
          : fetchApiJson<{ artists: CollectorOverlapArtistRow[] }>(
              overlapArtistsUrl(
                props.latestRunDate,
                collectorA,
                collectorB,
                props.useEntityPlaylistsForTotals,
              ),
            ).then((data) => {
              if (fetchGen.current !== gen) return;
              setArtists(data.artists ?? []);
            });

      void request
        .catch((e) => {
          if (fetchGen.current !== gen) return;
          setError(e instanceof Error ? e.message : String(e));
          setTracks([]);
          setArtists([]);
        })
        .finally(() => {
          if (fetchGen.current !== gen) return;
          setLoading(false);
        });
    },
    [basis, props.latestRunDate, props.useEntityPlaylistsForTotals],
  );

  const entityLabel = basis === "tracks" ? "track" : "artist";
  const entityLabelPlural = basis === "tracks" ? "tracks" : "artists";

  return (
    <>
      <div className="sb-card p-4 space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <div className="text-xs font-medium uppercase tracking-wider opacity-60">Catalog overlap</div>
            <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
              {valueMode === "count"
                ? `Shared ${entityLabelPlural} across collector playlists at latest data date. Each pair is shown once (symmetric). Click a non-zero cell to list ${entityLabelPlural}.`
                : `Jaccard similarity between collector catalogs. Each pair is shown once (symmetric). Click a non-zero cell to list shared ${entityLabelPlural}.`}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ChipGroup segmented>
              {(["tracks", "artists"] as const).map((b) => (
                <Chip key={b} segmented selected={basis === b} onClick={() => switchBasis(b)}>
                  {b === "tracks" ? "Tracks" : "Artists"}
                </Chip>
              ))}
            </ChipGroup>
            <ChipGroup segmented aria-label="Overlap display format">
              <Chip
                segmented
                selected={valueMode === "count"}
                onClick={() => setValueMode("count")}
                title="Shared counts"
              >
                #
              </Chip>
              <Chip
                segmented
                selected={valueMode === "percent"}
                onClick={() => setValueMode("percent")}
                title="Jaccard similarity"
              >
                %
              </Chip>
            </ChipGroup>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className="p-2 text-left opacity-60" />
                {activeCollectors.map(({ collector, color }) => (
                  <th key={collector} className="p-2 text-center font-medium">
                    <span className="inline-flex items-center justify-center gap-1.5">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: color }}
                        aria-hidden
                      />
                      {collector}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activeCollectors.map((row, rowIndex) => (
                <tr key={row.collector}>
                  <th className="p-2 text-left font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: row.color }}
                        aria-hidden
                      />
                      {row.collector}
                    </span>
                  </th>
                  {activeCollectors.map((col, colIndex) => {
                    if (colIndex > rowIndex) {
                      return <td key={col.collector} className="p-2" aria-hidden />;
                    }

                    if (colIndex === rowIndex) {
                      return <td key={col.collector} className="p-2" aria-hidden />;
                    }

                    const trackCell = lookupOverlap(overlapLookup, row.collector, col.collector);
                    const artistCell = lookupOverlapArtist(
                      overlapArtistLookup,
                      row.collector,
                      col.collector,
                    );
                    const cell = basis === "tracks" ? trackCell : artistCell;
                    if (!cell) {
                      return <td key={col.collector} className="p-2" />;
                    }

                    const sharedCount =
                      basis === "tracks"
                        ? (cell as OverlapCell).shared_isrcs
                        : (cell as OverlapArtistCell).shared_artists;
                    const jaccard = Number(cell.jaccard);
                    const jaccardPct = jaccard * 100;
                    const displayValue =
                      valueMode === "count" ? formatInt(sharedCount) : formatJaccardPercent(jaccard);
                    const title =
                      sharedCount > 0
                        ? `${formatInt(sharedCount)} shared ${entityLabelPlural} · Jaccard ${jaccardPct.toFixed(1)}% · Click for list`
                        : `${formatInt(sharedCount)} shared ${entityLabelPlural} · Jaccard ${jaccardPct.toFixed(1)}%`;

                    if (sharedCount <= 0) {
                      return (
                        <td
                          key={col.collector}
                          className="p-2 text-center font-mono tabular-nums text-[var(--sb-text)] opacity-60"
                          title={title}
                        >
                          {valueMode === "count" ? "0" : "0%"}
                        </td>
                      );
                    }

                    return (
                      <td key={col.collector} className="p-0">
                        <button
                          type="button"
                          className={[
                            "w-full p-2 text-center font-mono font-medium tabular-nums transition",
                            "text-[var(--sb-text)]",
                            "hover:bg-white/10",
                            "hover:ring-2 hover:ring-inset hover:ring-white/25",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40",
                          ].join(" ")}
                          title={title}
                          onClick={() => openOverlap(row.collector, col.collector, sharedCount)}
                        >
                          {displayValue}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <CompetitorOverlapTracksModal
        open={basis === "tracks" && modal != null}
        onClose={closeModal}
        title="Shared collector tracks"
        subtitle={
          modal
            ? `${modal.collectorA} × ${modal.collectorB} · ${formatInt(modal.sharedCount)} shared tracks`
            : ""
        }
        tracks={tracks}
        loading={loading}
        error={error}
      />

      <CompetitorOverlapArtistsModal
        open={basis === "artists" && modal != null}
        onClose={closeModal}
        title="Shared collector artists"
        subtitle={
          modal
            ? `${modal.collectorA} × ${modal.collectorB} · ${formatInt(modal.sharedCount)} shared artists`
            : ""
        }
        artists={artists}
        loading={loading}
        error={error}
      />
    </>
  );
}
