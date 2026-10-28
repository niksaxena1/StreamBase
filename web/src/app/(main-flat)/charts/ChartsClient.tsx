"use client";

import { ExternalLink } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Fragment, useMemo, useState } from "react";

import { PageHeader } from "@/components/shell/PageHeader";
import { EmptyStateCard, GlassTable, TableCell, TableRow } from "@/components/ui/GlassTable";
import { Select } from "@/components/ui/Select";
import { SpotlightCard } from "@/components/ui/SpotlightCard";
import {
  artistsText,
  buildChartSummary,
  buildLabelLeaderboard,
  movementBannerText,
  movementDisplay,
  remixText,
  type ChartDropoutRow,
  type ChartMovementRow,
  type MovementKind,
} from "@/lib/charts/chartsModel";
import type { ChartsPageData } from "@/lib/charts/loadChartsPage";
import { cx } from "@/lib/cx";

import { ChartPositionHistory } from "./ChartPositionHistory";

const MOVE_CLASS: Record<MovementKind, string> = {
  up: "text-emerald-700 dark:text-emerald-400 font-semibold",
  down: "text-red-700 dark:text-red-400 font-semibold",
  new: "",
  re: "",
  same: "",
  none: "",
};

function Artwork({ src, size = 40 }: { src: string | null; size?: number }) {
  if (!src) {
    return (
      <div
        className="rounded-md"
        style={{ width: size, height: size, background: "var(--sb-row-hover)" }}
        aria-hidden
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- small fixed-size external thumbnail
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      className="rounded-md object-cover"
      style={{ width: size, height: size, background: "var(--sb-row-hover)" }}
    />
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: "new" | "re" }) {
  return (
    <span
      className="inline-block rounded px-1.5 py-0.5 text-[10px] font-bold leading-none"
      style={
        tone === "new"
          ? { background: "var(--sb-accent)", color: "var(--sb-accent-text, #000)" }
          : { background: "var(--sb-row-hover)", color: "var(--sb-text)", border: "1px solid var(--sb-border)" }
      }
    >
      {children}
    </span>
  );
}

function MovementCell({ row, hasCompare }: { row: ChartMovementRow; hasCompare: boolean }) {
  const m = movementDisplay(row, hasCompare);
  if (m.kind === "none") return null;
  if (m.kind === "new") return <Badge tone="new">NEW</Badge>;
  if (m.kind === "re") return <Badge tone="re">RE</Badge>;
  return (
    <span
      className={cx("tabular-nums", MOVE_CLASS[m.kind])}
      style={m.kind === "same" ? { color: "var(--sb-muted)" } : undefined}
      title={m.label}
    >
      {m.text}
    </span>
  );
}

function SummaryCard({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <SpotlightCard className="p-3">
      <div className="text-[11px] uppercase tracking-wider" style={{ color: "var(--sb-muted)" }}>
        {label}
      </div>
      <div className="mt-1 truncate text-lg font-semibold tabular-nums" style={{ color: "var(--sb-text)" }}>
        {value}
      </div>
      <div className="mt-0.5 min-h-[1rem] truncate text-xs" style={{ color: "var(--sb-muted)" }}>
        {sub}
      </div>
    </SpotlightCard>
  );
}

function TitleBlock({ name, mix, artists, remix, artistsFromMd = true }: { name: string; mix: string | null; artists: string[] | null; remix?: string | null; artistsFromMd?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="truncate font-medium" style={{ color: "var(--sb-text)" }}>
        {name}
        {mix ? <span style={{ color: "var(--sb-muted)" }}> ({mix})</span> : null}
      </div>
      <div className={cx("truncate", !artistsFromMd && "md:hidden")} style={{ color: "var(--sb-muted)" }}>
        {artistsText(artists)}
        {remix ? <span className="opacity-80"> · {remix}</span> : null}
      </div>
    </div>
  );
}

const DESKTOP_ONLY = "hidden sm:table-cell";

export function ChartsClient({ data }: { data: ChartsPageData }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [expanded, setExpanded] = useState<string | null>(null);

  const { rows, dropouts, snapshotDate, compareDate, compareDays } = data;
  const hasCompare = compareDate != null;

  const summary = useMemo(() => buildChartSummary(rows, dropouts, hasCompare), [rows, dropouts, hasCompare]);
  const labels = useMemo(() => buildLabelLeaderboard(rows, dropouts, hasCompare), [rows, dropouts, hasCompare]);

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value == null) next.delete(key);
    else next.set(key, value);
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  const subtitle = snapshotDate
    ? `${data.displayName} · snapshot ${snapshotDate} (UTC)${hasCompare ? ` · compared with ${compareDate}` : ""}`
    : data.displayName;

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      {data.snapshotDates.length > 0 ? (
        <Select
          aria-label="Snapshot date"
          className="!w-auto !py-1.5 text-xs"
          value={snapshotDate ?? ""}
          onChange={(e) => setParam("date", e.target.value === data.snapshotDates[0] ? null : e.target.value)}
        >
          {data.snapshotDates.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </Select>
      ) : null}
      <Select
        aria-label="Compare with"
        className="!w-auto !py-1.5 text-xs"
        value={String(compareDays)}
        onChange={(e) => setParam("compare", e.target.value === "7" ? null : e.target.value)}
      >
        <option value="7">vs 7 days ago</option>
        <option value="1">vs yesterday</option>
      </Select>
      <a
        href={data.chartUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs underline-offset-2 hover:underline"
        style={{ color: "var(--sb-muted)" }}
      >
        Open on Beatport <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );

  if (!snapshotDate) {
    return (
      <div className="space-y-4">
        <PageHeader title="Charts" subtitle={subtitle} actions={actions} />
        <EmptyStateCard
          title="No snapshot yet"
          description="First snapshot arrives after the daily run."
        />
      </div>
    );
  }

  const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

  return (
    <div className="min-w-0 space-y-4">
      <PageHeader title="Charts" subtitle={subtitle} actions={actions} />

      {!hasCompare ? (
        <div
          className="sb-card rounded-xl px-3 py-2 text-xs"
          style={{ color: "var(--sb-muted)", border: "1px solid var(--sb-border)" }}
          role="status"
        >
          {movementBannerText(compareDays)}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <SummaryCard label="New entries" value={summary.newCount ?? "—"} />
        <SummaryCard label="Re-entries" value={summary.reentryCount ?? "—"} />
        <SummaryCard
          label="Biggest climber"
          value={summary.climber ? `▲${summary.climber.change}` : "—"}
          sub={summary.climber?.name}
        />
        <SummaryCard
          label="Biggest faller"
          value={summary.faller ? `▼${Math.abs(summary.faller.change)}` : "—"}
          sub={summary.faller?.name}
        />
        <SummaryCard label="Dropped out" value={summary.droppedCount ?? "—"} />
        <SummaryCard
          label="Top label"
          value={summary.topLabel ? summary.topLabel.label : "—"}
          sub={summary.topLabel ? `${summary.topLabel.spots} ${summary.topLabel.spots === 1 ? "spot" : "spots"}` : undefined}
        />
      </div>

      <GlassTable
        maxBodyHeightClassName="max-h-[75vh]"
        headers={[
          { label: "#", align: "right" },
          { label: "", className: "w-10" },
          { label: "" },
          "Title",
          { label: "Artists", className: "hidden md:table-cell" },
          { label: "Label", className: "hidden sm:table-cell" },
          { label: "Released", className: "hidden lg:table-cell" },
          { label: "BPM", align: "right", className: DESKTOP_ONLY },
          { label: "Key", className: DESKTOP_ONLY },
          { label: "Days", align: "right", className: DESKTOP_ONLY },
          { label: "Peak", align: "right", className: DESKTOP_ONLY },
        ]}
      >
        {rows.map((r) => {
          const id = `${r.source}:${r.source_track_id}`;
          const open = expanded === id;
          const toggle = () => setExpanded(open ? null : id);
          return (
            <Fragment key={id}>
              <TableRow
                onClick={toggle}
                className="cursor-pointer"
                aria-expanded={open}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    toggle();
                  }
                }}
              >
                <TableCell numeric className="font-semibold">{r.position}</TableCell>
                <TableCell className="w-10 whitespace-nowrap text-[11px]">
                  <MovementCell row={r} hasCompare={hasCompare} />
                </TableCell>
                <TableCell className="w-12 !pr-0">
                  <Artwork src={r.image_url} />
                </TableCell>
                <TableCell className="max-w-[16rem] sm:max-w-xs">
                  {r.track_url ? (
                    <a
                      href={r.track_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="block hover:underline"
                    >
                      <TitleBlock
                        name={r.name}
                        mix={r.mix_name}
                        artists={r.artists}
                        remix={remixText(r.remixers)}
                        artistsFromMd={false}
                      />
                    </a>
                  ) : (
                    <TitleBlock name={r.name} mix={r.mix_name} artists={r.artists} remix={remixText(r.remixers)} artistsFromMd={false} />
                  )}
                </TableCell>
                <TableCell className={cx("hidden max-w-[14rem] md:table-cell")}>
                  <div className="truncate">
                    {artistsText(r.artists)}
                    {remixText(r.remixers) ? (
                      <span style={{ color: "var(--sb-muted)" }}> · {remixText(r.remixers)}</span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="hidden max-w-[10rem] sm:table-cell">
                  <div className="truncate">{r.label_name}</div>
                </TableCell>
                <TableCell className="hidden whitespace-nowrap lg:table-cell">{r.release_date}</TableCell>
                <TableCell numeric className={DESKTOP_ONLY}>{r.bpm}</TableCell>
                <TableCell className={cx(DESKTOP_ONLY, "whitespace-nowrap")}>
                  {r.musical_key}
                  {r.camelot ? <span style={{ color: "var(--sb-muted)" }}> {r.camelot}</span> : null}
                </TableCell>
                <TableCell numeric className={DESKTOP_ONLY}>{r.days_on_chart}</TableCell>
                <TableCell numeric className={DESKTOP_ONLY}>{r.peak_position}</TableCell>
              </TableRow>
              {open ? (
                <tr>
                  <td colSpan={11} className="px-3 pb-3">
                    <div className="mb-1 text-[11px]" style={{ color: "var(--sb-muted)" }}>
                      Position, last 90 days
                    </div>
                    <ChartPositionHistory source={r.source} sourceTrackId={r.source_track_id} endDate={snapshotDate} />
                  </td>
                </tr>
              ) : null}
            </Fragment>
          );
        })}
      </GlassTable>

      {hasCompare ? <DroppedOut dropouts={dropouts} compareDate={compareDate} /> : null}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold" style={{ color: "var(--sb-text)" }}>
          Labels
        </h2>
        <GlassTable
          maxBodyHeightClassName="max-h-[420px]"
          headers={[
            "Label",
            { label: "Spots", align: "right" },
            { label: hasCompare ? "Change" : "", align: "right" },
          ]}
        >
          {labels.map((l) => (
            <TableRow key={l.label}>
              <TableCell className="max-w-[14rem]">
                <div className="truncate">{l.label}</div>
              </TableCell>
              <TableCell numeric>{l.spots}</TableCell>
              <TableCell numeric>
                {l.change == null ? null : l.change === 0 ? (
                  <span style={{ color: "var(--sb-muted)" }}>–</span>
                ) : (
                  <span
                    className={
                      l.change > 0
                        ? "text-emerald-700 dark:text-emerald-400"
                        : "text-red-700 dark:text-red-400"
                    }
                  >
                    {signed(l.change)}
                  </span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </GlassTable>
      </section>
    </div>
  );
}

function DroppedOut({ dropouts, compareDate }: { dropouts: ChartDropoutRow[]; compareDate: string | null }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold" style={{ color: "var(--sb-text)" }}>
        Dropped out
        <span className="ml-2 text-xs font-normal" style={{ color: "var(--sb-muted)" }}>
          on {compareDate} but not on this snapshot
        </span>
      </h2>
      {dropouts.length === 0 ? (
        <div className="sb-card rounded-xl px-3 py-3 text-xs" style={{ color: "var(--sb-muted)" }}>
          Nothing dropped out.
        </div>
      ) : (
        <GlassTable
          maxBodyHeightClassName="max-h-[420px]"
          headers={[
            { label: "Was", align: "right" },
            { label: "" },
            "Title",
            { label: "Label", className: "hidden sm:table-cell" },
          ]}
        >
          {dropouts.map((d) => (
            <TableRow key={`${d.source}:${d.source_track_id}`}>
              <TableCell numeric>{d.prev_position}</TableCell>
              <TableCell className="w-12 !pr-0">
                <Artwork src={d.image_url} />
              </TableCell>
              <TableCell className="max-w-[16rem] sm:max-w-xs">
                {d.track_url ? (
                  <a href={d.track_url} target="_blank" rel="noopener noreferrer" className="block hover:underline">
                    <TitleBlock name={d.name} mix={d.mix_name} artists={d.artists} />
                  </a>
                ) : (
                  <TitleBlock name={d.name} mix={d.mix_name} artists={d.artists} />
                )}
              </TableCell>
              <TableCell className="hidden max-w-[10rem] sm:table-cell">
                <div className="truncate">{d.label_name}</div>
              </TableCell>
            </TableRow>
          ))}
        </GlassTable>
      )}
    </section>
  );
}
