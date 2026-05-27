"use client";

import type { LabelRow, OverlapCell } from "./competitorsTypes";
import { lookupOverlap } from "./competitorsUtils";

export function CompetitorsOverlapMatrix(props: {
  activeLabels: LabelRow[];
  overlapLookup: Map<string, OverlapCell>;
}) {
  const { activeLabels, overlapLookup } = props;

  return (
    <div className="sb-card p-4 space-y-3">
      <div>
        <div className="text-xs font-medium uppercase tracking-wider opacity-60">Catalog overlap</div>
        <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
          Jaccard similarity of active catalogs at latest data date
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
                  const pct = cell ? Number(cell.jaccard) * 100 : 0;
                  return (
                    <td
                      key={colLabel.label_key}
                      className="p-2 text-center font-mono tabular-nums"
                      title={
                        cell
                          ? `${cell.shared_isrcs} shared ISRCs · Jaccard ${pct.toFixed(1)}%`
                          : "No overlap data"
                      }
                      style={{
                        background: `color-mix(in srgb, var(--sb-accent) ${Math.min(pct * 4, 80)}%, transparent)`,
                      }}
                    >
                      {cell ? `${pct.toFixed(1)}%` : "—"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
