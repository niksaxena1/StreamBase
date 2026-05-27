"use client";

import { useCallback, useRef, useState } from "react";

import { fetchApiJson } from "@/lib/api";
import { formatInt } from "@/lib/format";

import { CompetitorOverlapTracksModal } from "./CompetitorOverlapTracksModal";
import type { LabelRow, OverlapCell, OverlapTrackRow } from "./competitorsTypes";
import { lookupOverlap } from "./competitorsUtils";

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

export function CompetitorsOverlapMatrix(props: {
  activeLabels: LabelRow[];
  overlapLookup: Map<string, OverlapCell>;
  latestRunDate: string;
}) {
  const { activeLabels, overlapLookup, latestRunDate } = props;
  const labelNameByKey = useRef(
    new Map(activeLabels.map((l) => [l.label_key, l.display_name] as const)),
  );
  labelNameByKey.current = new Map(activeLabels.map((l) => [l.label_key, l.display_name] as const));

  const [modal, setModal] = useState<OverlapModalState | null>(null);
  const [tracks, setTracks] = useState<OverlapTrackRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchGen = useRef(0);

  const closeModal = useCallback(() => {
    setModal(null);
    setTracks([]);
    setError(null);
    setLoading(false);
    fetchGen.current += 1;
  }, []);

  const openOverlap = useCallback(
    (cell: OverlapCell) => {
      if (cell.shared_isrcs <= 0) return;

      const labelA = cell.label_a;
      const labelB = cell.label_b;
      const labelAName = labelNameByKey.current.get(labelA) ?? labelA;
      const labelBName = labelNameByKey.current.get(labelB) ?? labelB;

      setModal({
        labelA,
        labelB,
        labelAName,
        labelBName,
        sharedCount: cell.shared_isrcs,
      });
      setTracks([]);
      setError(null);
      setLoading(true);

      const gen = ++fetchGen.current;
      void fetchApiJson<{ tracks: OverlapTrackRow[] }>(
        overlapTracksUrl(latestRunDate, labelA, labelB),
      )
        .then((data) => {
          if (fetchGen.current !== gen) return;
          setTracks(data.tracks ?? []);
        })
        .catch((e) => {
          if (fetchGen.current !== gen) return;
          setError(e instanceof Error ? e.message : String(e));
          setTracks([]);
        })
        .finally(() => {
          if (fetchGen.current !== gen) return;
          setLoading(false);
        });
    },
    [latestRunDate],
  );

  return (
    <>
      <div className="sb-card p-4 space-y-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wider opacity-60">Catalog overlap</div>
          <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
            Shared track counts in both catalogs at latest data date. Click a non-zero cell to list tracks.
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
              {activeLabels.map((rowLabel) => (
                <tr key={rowLabel.label_key}>
                  <th className="p-2 text-left font-medium">{rowLabel.display_name}</th>
                  {activeLabels.map((colLabel) => {
                    if (rowLabel.label_key === colLabel.label_key) {
                      return (
                        <td key={colLabel.label_key} className="p-2 text-center opacity-40">
                          —
                        </td>
                      );
                    }
                    const cell = lookupOverlap(overlapLookup, rowLabel.label_key, colLabel.label_key);
                    const sharedCount = cell?.shared_isrcs ?? 0;
                    const clickable = sharedCount > 0;
                    const jaccardPct = cell ? Number(cell.jaccard) * 100 : 0;

                    const title = cell
                      ? clickable
                        ? `${formatInt(sharedCount)} shared tracks · Jaccard ${jaccardPct.toFixed(1)}% · Click for track list`
                        : `${formatInt(sharedCount)} shared tracks · Jaccard ${jaccardPct.toFixed(1)}%`
                      : "No overlap data";

                    const content = cell ? formatInt(sharedCount) : "—";

                    if (!clickable) {
                      return (
                        <td
                          key={colLabel.label_key}
                          className="p-2 text-center font-mono tabular-nums opacity-70"
                          title={title}
                        >
                          {content}
                        </td>
                      );
                    }

                    return (
                      <td key={colLabel.label_key} className="p-0">
                        <button
                          type="button"
                          className={[
                            "sb-tracks w-full p-2 text-center font-mono font-medium tabular-nums transition",
                            "hover:bg-[color-mix(in_srgb,var(--sb-tracks)_12%,transparent)]",
                            "hover:ring-2 hover:ring-inset hover:ring-[var(--sb-tracks)]",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sb-tracks)]",
                          ].join(" ")}
                          title={title}
                          onClick={() => openOverlap(cell!)}
                        >
                          {content}
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
        open={modal != null}
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
    </>
  );
}
