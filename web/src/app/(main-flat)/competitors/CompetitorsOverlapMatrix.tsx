"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import { Chip, ChipGroup } from "@/components/ui/Chip";
import { fetchApiJson } from "@/lib/api";
import { formatInt } from "@/lib/format";

import { CompetitorOverlapArtistsModal } from "./CompetitorOverlapArtistsModal";
import { CompetitorOverlapTracksModal } from "./CompetitorOverlapTracksModal";
import type {
  LabelRow,
  OverlapArtistCell,
  OverlapArtistRow,
  OverlapBasis,
  OverlapCell,
  OverlapTrackRow,
} from "./competitorsTypes";
import {
  isOwnCatalogLabelKey,
  lookupOwnOverlap,
  type OwnOverlapCell,
} from "@/lib/competitors/ownCatalog";

import { lookupOverlap, lookupOverlapArtist } from "./competitorsUtils";

type OverlapModalState = {
  labelA: string;
  labelB: string;
  labelAName: string;
  labelBName: string;
  sharedCount: number;
};

function overlapTracksUrl(runDate: string, labelA: string, labelB: string) {
  const q = new URLSearchParams({
    run_date: runDate,
    label_a: labelA,
    label_b: labelB,
  });
  return `/api/competitors/overlap-tracks?${q.toString()}`;
}

function overlapArtistsUrl(runDate: string, labelA: string, labelB: string) {
  const q = new URLSearchParams({
    run_date: runDate,
    label_a: labelA,
    label_b: labelB,
  });
  return `/api/competitors/overlap-artists?${q.toString()}`;
}

function ownOverlapTracksUrl(runDate: string, competitorLabelKey: string) {
  const q = new URLSearchParams({
    run_date: runDate,
    competitor_label_key: competitorLabelKey,
  });
  return `/api/competitors/own-overlap-tracks?${q.toString()}`;
}

function ownOverlapArtistsUrl(runDate: string, competitorLabelKey: string) {
  const q = new URLSearchParams({
    run_date: runDate,
    competitor_label_key: competitorLabelKey,
  });
  return `/api/competitors/own-overlap-artists?${q.toString()}`;
}

type OverlapValueMode = "count" | "percent";

function formatJaccardPercent(jaccard: number): string {
  const pct = Number(jaccard) * 100;
  if (!Number.isFinite(pct) || pct <= 0) return "0%";
  if (pct < 0.1) return "<0.1%";
  if (pct >= 10) return `${Math.round(pct)}%`;
  return `${pct.toFixed(1)}%`;
}

export function CompetitorsOverlapMatrix(props: {
  activeLabels: LabelRow[];
  overlapLookup: Map<string, OverlapCell>;
  overlapArtistLookup?: Map<string, OverlapArtistCell>;
  ownOverlapLookup?: Map<string, OwnOverlapCell>;
  ownOverlapArtistLookup?: Map<string, OwnOverlapCell>;
  latestRunDate: string;
}) {
  const { overlapLookup, latestRunDate } = props;
  const overlapArtistLookup = props.overlapArtistLookup ?? new Map<string, OverlapArtistCell>();
  const ownOverlapLookup = props.ownOverlapLookup ?? new Map<string, OwnOverlapCell>();
  const ownOverlapArtistLookup = props.ownOverlapArtistLookup ?? new Map<string, OwnOverlapCell>();
  const activeLabels = useMemo(() => {
    const competitors = props.activeLabels.filter((l) => !isOwnCatalogLabelKey(l.label_key));
    const own = props.activeLabels.find((l) => isOwnCatalogLabelKey(l.label_key));
    return own ? [...competitors, own] : competitors;
  }, [props.activeLabels]);
  const labelNameByKey = useMemo(
    () => new Map(activeLabels.map((l) => [l.label_key, l.display_name] as const)),
    [activeLabels],
  );

  const [basis, setBasis] = useState<OverlapBasis>("artists");
  const [valueMode, setValueMode] = useState<OverlapValueMode>("count");
  const [modal, setModal] = useState<OverlapModalState | null>(null);
  const [tracks, setTracks] = useState<OverlapTrackRow[]>([]);
  const [artists, setArtists] = useState<OverlapArtistRow[]>([]);
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
    (next: OverlapBasis) => {
      if (next === basis) return;
      closeModal();
      setBasis(next);
    },
    [basis, closeModal],
  );

  const openOverlap = useCallback(
    (labelA: string, labelB: string, sharedCount: number) => {
      if (sharedCount <= 0) return;

      const labelAName = labelNameByKey.get(labelA) ?? labelA;
      const labelBName = labelNameByKey.get(labelB) ?? labelB;

      setModal({ labelA, labelB, labelAName, labelBName, sharedCount });
      setTracks([]);
      setArtists([]);
      setError(null);
      setLoading(true);

      const gen = ++fetchGen.current;
      const involvesOwn = isOwnCatalogLabelKey(labelA) || isOwnCatalogLabelKey(labelB);
      const competitorKey = isOwnCatalogLabelKey(labelA) ? labelB : labelA;
      const request =
        basis === "tracks"
          ? involvesOwn
            ? fetchApiJson<{ tracks: OverlapTrackRow[] }>(
                ownOverlapTracksUrl(latestRunDate, competitorKey),
              ).then((data) => {
                if (fetchGen.current !== gen) return;
                setTracks(data.tracks ?? []);
              })
            : fetchApiJson<{ tracks: OverlapTrackRow[] }>(
                overlapTracksUrl(latestRunDate, labelA, labelB),
              ).then((data) => {
                if (fetchGen.current !== gen) return;
                setTracks(data.tracks ?? []);
              })
          : involvesOwn
            ? fetchApiJson<{ artists: OverlapArtistRow[] }>(
                ownOverlapArtistsUrl(latestRunDate, competitorKey),
              ).then((data) => {
                if (fetchGen.current !== gen) return;
                setArtists(data.artists ?? []);
              })
            : fetchApiJson<{ artists: OverlapArtistRow[] }>(
                overlapArtistsUrl(latestRunDate, labelA, labelB),
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
    [basis, labelNameByKey, latestRunDate],
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
                ? `Shared ${entityLabelPlural} in both catalogs at latest data date. Each pair is shown once (symmetric). Click a non-zero cell to list ${entityLabelPlural}.`
                : `Jaccard similarity between catalogs. Each pair is shown once (symmetric). Click a non-zero cell to list shared ${entityLabelPlural}.`}
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
                {activeLabels.map((l) => (
                  <th key={l.label_key} className="p-2 text-center font-medium">
                    {l.display_name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activeLabels.map((rowLabel, rowIndex) => (
                <tr key={rowLabel.label_key}>
                  <th className="p-2 text-left font-medium">{rowLabel.display_name}</th>
                  {activeLabels.map((colLabel, colIndex) => {
                    if (colIndex > rowIndex) {
                      return <td key={colLabel.label_key} className="p-2" aria-hidden />;
                    }

                    if (colIndex === rowIndex) {
                      return <td key={colLabel.label_key} className="p-2" aria-hidden />;
                    }

                    const involvesOwn =
                      isOwnCatalogLabelKey(rowLabel.label_key) ||
                      isOwnCatalogLabelKey(colLabel.label_key);
                    let sharedCount = 0;
                    let jaccard = 0;

                    if (involvesOwn) {
                      const competitorKey = isOwnCatalogLabelKey(rowLabel.label_key)
                        ? colLabel.label_key
                        : rowLabel.label_key;
                      const ownCell =
                        basis === "tracks"
                          ? lookupOwnOverlap(ownOverlapLookup, competitorKey)
                          : lookupOwnOverlap(ownOverlapArtistLookup, competitorKey);
                      if (!ownCell) {
                        return <td key={colLabel.label_key} className="p-2" />;
                      }
                      sharedCount = ownCell.shared_count;
                      jaccard = Number(ownCell.jaccard);
                    } else {
                      const trackCell = lookupOverlap(
                        overlapLookup,
                        rowLabel.label_key,
                        colLabel.label_key,
                      );
                      const artistCell = lookupOverlapArtist(
                        overlapArtistLookup,
                        rowLabel.label_key,
                        colLabel.label_key,
                      );
                      const cell = basis === "tracks" ? trackCell : artistCell;
                      if (!cell) {
                        return <td key={colLabel.label_key} className="p-2" />;
                      }
                      sharedCount =
                        basis === "tracks"
                          ? (cell as OverlapCell).shared_isrcs
                          : (cell as OverlapArtistCell).shared_artists;
                      jaccard = Number(cell.jaccard);
                    }

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
                          key={colLabel.label_key}
                          className="p-2 text-center font-mono tabular-nums text-[var(--sb-text)] opacity-60"
                          title={title}
                        >
                          {valueMode === "count" ? "0" : "0%"}
                        </td>
                      );
                    }

                    return (
                      <td key={colLabel.label_key} className="p-0">
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
                          onClick={() =>
                            openOverlap(rowLabel.label_key, colLabel.label_key, sharedCount)
                          }
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
        title="Shared catalog tracks"
        subtitle={
          modal
            ? `${modal.labelAName} × ${modal.labelBName} · ${formatInt(modal.sharedCount)} shared tracks`
            : ""
        }
        tracks={tracks}
        loading={loading}
        error={error}
      />

      <CompetitorOverlapArtistsModal
        open={basis === "artists" && modal != null}
        onClose={closeModal}
        title="Shared catalog artists"
        subtitle={
          modal
            ? `${modal.labelAName} × ${modal.labelBName} · ${formatInt(modal.sharedCount)} shared artists`
            : ""
        }
        artists={artists}
        loading={loading}
        error={error}
      />
    </>
  );
}
