"use client";

import { useMemo } from "react";

import { GlassTable, TableCell, TableRow } from "@/components/ui/GlassTable";
import { changeText, num, PctPill } from "@/app/(main-flat)/home/releaseWeeksUi";
import { isOwnCatalogLabelKey, OWN_CATALOG_ACCENT_HEX } from "@/lib/competitors/ownCatalog";
import { formatDateISO, formatInt } from "@/lib/format";

import { buildMa7WeekRows } from "./competitorMa7";
import type { LabelDailyPoint, LabelRow } from "./competitorsTypes";
import { labelColor } from "./competitorsUtils";

function VsOurs({ pts }: { pts: number | null }) {
  if (pts == null) return <span className="text-[11px] opacity-30">—</span>;
  const c = pts >= 2 ? "#22c55e" : pts <= -2 ? "#ef4444" : "var(--sb-muted)";
  return (
    <span
      className={`text-[11px] font-semibold ${num}`}
      style={{ color: c }}
      title="This label's % change minus Own Catalog's"
    >
      {pts > 0 ? "+" : ""}
      {pts.toFixed(1)} pts
    </span>
  );
}

const dash = <span className="opacity-30">—</span>;

export function CompetitorMa7Table({
  labels,
  labelSeries,
}: {
  labels: LabelRow[];
  labelSeries: LabelDailyPoint[];
}) {
  const latest = useMemo(
    () => labelSeries.reduce((max, p) => (p.date > max ? p.date : max), ""),
    [labelSeries],
  );

  const rows = useMemo(() => {
    const computed = buildMa7WeekRows(
      labelSeries,
      labels.map((l) => l.label_key),
    );
    const byKey = new Map(computed.map((r) => [r.labelKey, r]));
    const items = labels.map((label, index) => ({
      label,
      color: isOwnCatalogLabelKey(label.label_key)
        ? `#${OWN_CATALOG_ACCENT_HEX}`
        : labelColor(label, index),
      row: byKey.get(label.label_key)!,
    }));
    const own = items.filter((i) => isOwnCatalogLabelKey(i.label.label_key));
    const rest = items
      .filter((i) => !isOwnCatalogLabelKey(i.label.label_key))
      .sort((a, b) => {
        if (a.row.pct == null && b.row.pct == null) return 0;
        if (a.row.pct == null) return 1;
        if (b.row.pct == null) return -1;
        return a.row.pct - b.row.pct;
      });
    return [...own, ...rest];
  }, [labelSeries, labels]);

  return (
    <section className="sb-card p-4">
      <h2 className="text-sm font-semibold">MA7 week on week</h2>
      <p className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
        7-day average of daily streams, latest 7 days vs the 7 before (to {latest ? formatDateISO(latest) : "—"})
      </p>
      <div className="mt-3">
        <GlassTable
          headers={[
            { label: "Label" },
            { label: "MA7 now", align: "right" },
            { label: "MA7 prior week", align: "right" },
            { label: "Change", align: "right" },
            { label: "%", align: "right" },
            { label: "vs Ours", align: "right" },
          ]}
        >
          {rows.map(({ label, color, row }) => {
            const isOwn = isOwnCatalogLabelKey(label.label_key);
            const change = row.ma7Now != null && row.ma7Prev != null ? Math.round(row.ma7Now - row.ma7Prev) : null;
            return (
              <TableRow key={label.label_key}>
                <TableCell>
                  <span className={`inline-flex items-center gap-2 ${isOwn ? "font-semibold" : "font-medium"}`}>
                    <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                    {label.display_name}
                  </span>
                </TableCell>
                <TableCell numeric>{row.ma7Now != null ? formatInt(Math.round(row.ma7Now)) : dash}</TableCell>
                <TableCell numeric>{row.ma7Prev != null ? formatInt(Math.round(row.ma7Prev)) : dash}</TableCell>
                <TableCell numeric>{change != null ? changeText(change) : dash}</TableCell>
                <TableCell numeric>
                  <PctPill pct={row.pct} empty="—" />
                </TableCell>
                <TableCell numeric>
                  {isOwn ? <span aria-hidden="true" /> : <VsOurs pts={row.vsOursPts} />}
                </TableCell>
              </TableRow>
            );
          })}
        </GlassTable>
      </div>
      <p className="mt-2 text-[10px] opacity-50">
        Uses net daily streams, so an uncorrected counter reset lowers the MA7 until it is fixed.
      </p>
    </section>
  );
}
