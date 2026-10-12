"use client";

import { AudioLines, FileSignature, Hash } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { formatReleaseDate } from "@/lib/library/format";
import { BUSY_WEEK_THRESHOLD, groupByWeek, type ScheduleWeek } from "@/lib/library/schedule";
import type { LibraryRow } from "@/lib/library/types";

import { LibraryCover } from "./LibraryCover";
import { EntityBadge } from "./LibraryTable";

function Presence({ present, icon, label }: { present: boolean; icon: React.ReactNode; label: string }) {
  return (
    <span
      className="inline-flex"
      style={{ color: present ? "var(--sb-positive)" : "var(--sb-muted)", opacity: present ? 1 : 0.35 }}
      title={`${label}: ${present ? "yes" : "missing"}`}
      role="img"
      aria-label={`${label}: ${present ? "yes" : "missing"}`}
    >
      {icon}
    </span>
  );
}

function ScheduleRow({
  row,
  entityName,
  selected,
  onSelect,
  showDate,
}: {
  row: LibraryRow;
  entityName: string;
  selected: boolean;
  onSelect: (id: string) => void;
  showDate: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(row.catalog_id)}
        aria-current={selected || undefined}
        className="flex w-full items-center gap-3 px-3 py-1.5 text-left text-xs hover:bg-[var(--sb-row-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sb-accent)]"
        style={selected ? { background: "var(--sb-accent-10)" } : undefined}
      >
        <LibraryCover url={row.album_image_url} size={32} />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium">{row.sheet_artist || "Unknown artist"}</span>
          <span> – {row.sheet_title || "Untitled"}</span>
          {showDate && row.release_date ? (
            <span className="ml-2 tabular-nums" style={{ color: "var(--sb-muted)" }}>
              {formatReleaseDate(row.release_date)}
            </span>
          ) : null}
        </span>
        <span className="hidden w-24 flex-none sm:block">
          <EntityBadge code={row.entity} name={entityName} />
        </span>
        <span className="hidden w-32 flex-none truncate sm:block" style={{ color: "var(--sb-muted)" }} title={row.distributor_account ?? undefined}>
          {row.distributor_account ?? "—"}
        </span>
        <span className="flex flex-none items-center gap-2">
          <Presence present={row.has_m_master} label="Master" icon={<AudioLines className="h-3.5 w-3.5" />} />
          <Presence present={Boolean(row.isrc)} label="ISRC" icon={<Hash className="h-3.5 w-3.5" />} />
          <Presence present={row.has_signed_contract} label="Signed contract" icon={<FileSignature className="h-3.5 w-3.5" />} />
        </span>
      </button>
    </li>
  );
}

function WeekCard({
  week,
  maxCount,
  entityNames,
  selectedId,
  onSelect,
}: {
  week: ScheduleWeek;
  maxCount: number;
  entityNames: Map<string, string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const pct = maxCount > 0 ? Math.round((week.count / maxCount) * 100) : 0;
  return (
    <section className="sb-card overflow-hidden" aria-label={`Week of ${week.label}`}>
      <header className="space-y-1.5 px-3 py-2" style={{ boxShadow: week.empty ? undefined : "0 1px 0 0 var(--sb-border)" }}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 className="font-display text-sm font-semibold tracking-tight">{week.label}</h3>
          {week.current ? (
            <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: "var(--sb-accent-10)", border: "1px solid var(--sb-accent-20)" }}>
              This week
            </span>
          ) : null}
          <span className="text-xs tabular-nums" style={{ color: "var(--sb-muted)" }}>
            {week.empty ? "No releases" : `${week.count} ${week.count === 1 ? "release" : "releases"}`}
          </span>
          {week.busy ? (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-medium"
              style={{ color: "var(--sb-warning, #b45309)", border: "1px solid currentColor" }}
              title={`More than ${BUSY_WEEK_THRESHOLD} releases`}
            >
              Busy
            </span>
          ) : null}
          <span className="ml-auto flex flex-wrap items-center gap-1.5">
            {week.entities.map((e) => (
              <span key={e.code} className="rounded-full px-2 py-0.5 text-[10px] tabular-nums" style={{ background: "var(--sb-accent-10)" }}>
                {entityNames.get(e.code) ?? e.code.toUpperCase()} {e.count}
              </span>
            ))}
          </span>
        </div>
        {week.empty ? null : (
          <div
            className="h-1 w-full overflow-hidden rounded-full"
            style={{ background: "var(--sb-accent-10)" }}
            role="img"
            aria-label={`${week.count} of ${maxCount} releases in the busiest week`}
          >
            <div
              className="h-full rounded-full"
              style={{ width: `${pct}%`, background: week.busy ? "var(--sb-warning, #b45309)" : "var(--sb-accent)" }}
            />
          </div>
        )}
      </header>
      {week.empty ? null : (
        <ul>
          {week.rows.map((row) => (
            <ScheduleRow
              key={row.catalog_id}
              row={row}
              entityName={row.entity ? (entityNames.get(row.entity) ?? row.entity.toUpperCase()) : ""}
              selected={row.catalog_id === selectedId}
              onSelect={onSelect}
              showDate
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Filtered releases grouped by release week (Monday to Sunday, named by the Friday). */
export function LibrarySchedule({
  rows,
  today,
  entityNames,
  selectedId,
  onSelect,
}: {
  rows: LibraryRow[];
  today: string;
  entityNames: Map<string, string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [showPast, setShowPast] = useState(false);
  const schedule = useMemo(() => groupByWeek(rows, today, { showPast }), [rows, today, showPast]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-xs" style={{ color: "var(--sb-muted)" }}>
        <Button size="sm" variant="secondary" aria-pressed={showPast} onClick={() => setShowPast((v) => !v)}>
          {showPast ? "Hide past weeks" : "Show past weeks"}
        </Button>
        {!showPast && schedule.hiddenPast > 0 ? (
          <span>
            {schedule.hiddenPast.toLocaleString("en-US")} earlier {schedule.hiddenPast === 1 ? "release" : "releases"} hidden
          </span>
        ) : null}
      </div>

      {schedule.weeks.length === 0 && schedule.noDate.length === 0 ? (
        <p className="sb-card px-3 py-6 text-center text-xs" style={{ color: "var(--sb-muted)" }}>
          No upcoming releases match. Show past weeks to see earlier ones.
        </p>
      ) : null}

      {schedule.weeks.map((week) => (
        <WeekCard
          key={week.key}
          week={week}
          maxCount={schedule.maxCount}
          entityNames={entityNames}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ))}

      {schedule.noDate.length > 0 ? (
        <section className="sb-card overflow-hidden" aria-label="No date">
          <header className="flex items-center gap-3 px-3 py-2" style={{ boxShadow: "0 1px 0 0 var(--sb-border)" }}>
            <h3 className="font-display text-sm font-semibold tracking-tight">No date</h3>
            <span className="text-xs tabular-nums" style={{ color: "var(--sb-muted)" }}>
              {schedule.noDate.length} {schedule.noDate.length === 1 ? "release" : "releases"}
            </span>
          </header>
          <ul>
            {schedule.noDate.map((row) => (
              <ScheduleRow
                key={row.catalog_id}
                row={row}
                entityName={row.entity ? (entityNames.get(row.entity) ?? row.entity.toUpperCase()) : ""}
                selected={row.catalog_id === selectedId}
                onSelect={onSelect}
                showDate={false}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
