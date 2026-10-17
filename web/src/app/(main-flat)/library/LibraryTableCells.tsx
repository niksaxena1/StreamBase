"use client";

import { ArrowDown, ArrowUp, Check, Copy, ExternalLink, Folder } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import { LIBRARY_TABLE_COLUMNS, libraryPinnedOffsets, originalityInfo, type LibraryColumn } from "@/lib/library/columns";
import { defaultSortDir, type LibrarySortDir, type LibrarySortKey } from "@/lib/library/filters";
import { formatDuration, formatReleaseDate } from "@/lib/library/format";
import { formatCompactStreams, formatExactStreams } from "@/lib/library/streams";
import type { LibraryRow } from "@/lib/library/types";

import { LibraryCover } from "./LibraryCover";
import { LibraryLicensingBadge } from "./LibraryLicensingBadge";
import { LibraryHeaderFilter, type LibraryHeaderFilterProps } from "./LibraryHeaderFilter";
import styles from "./LibraryTable.module.css";

function Dash() {
  return (
    <span className="opacity-40" style={{ color: "var(--sb-muted)" }}>
      —
    </span>
  );
}

function Cell({ value, mono, muted }: { value: string | null; mono?: boolean; muted?: boolean }) {
  if (!value || !value.trim()) return <Dash />;
  return (
    <span
      className={["block truncate", mono ? "font-mono text-[11px]" : ""].join(" ")}
      style={muted ? { color: "var(--sb-muted)" } : undefined}
      title={value}
    >
      {value}
    </span>
  );
}

function StreamsCell({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return <Dash />;
  return (
    <span title={formatExactStreams(value)} className="tabular-nums">
      {formatCompactStreams(value)}
    </span>
  );
}

export function EntityBadge({ code, name }: { code: string | null; name: string }) {
  if (!code) return <Dash />;
  return (
    <span
      className="inline-block max-w-full truncate rounded-full px-2 py-0.5 text-[10px] font-medium"
      style={{ background: "var(--sb-accent-10)", color: "var(--sb-text)", border: "1px solid var(--sb-accent-20)" }}
      title={name}
    >
      {name}
    </span>
  );
}

/** Cover or Original icon with a hover tooltip; nothing when the value is unknown. */
export function OriginalityIcon({ row }: { row: Pick<LibraryRow, "originality" | "cover_original_artist"> }) {
  const info = originalityInfo(row);
  if (!info) return null;
  return (
    <span className="inline-flex items-center justify-center" title={info.text} role="img" aria-label={info.text}>
      {info.kind === "cover" ? (
        <Copy className="h-3.5 w-3.5" style={{ color: "var(--sb-info)" }} aria-hidden="true" />
      ) : (
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--sb-muted)", opacity: 0.6 }} aria-hidden="true" />
      )}
    </span>
  );
}

export function SelectBox({
  checked,
  indeterminate,
  label,
  onClick,
}: {
  checked: boolean;
  indeterminate?: boolean;
  label: string;
  onClick: (shift: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = Boolean(indeterminate);
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      checked={checked}
      // The click handler does the work so it can read the shift key; onChange only keeps React quiet.
      onChange={() => {}}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e.shiftKey);
      }}
      onKeyDown={(e) => e.stopPropagation()}
      className="h-3.5 w-3.5 cursor-pointer accent-[var(--sb-accent)]"
    />
  );
}

const alignClass = (c: LibraryColumn) => (c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left");

/**
 * One header cell per column, in the same order as `RowCells`. Each is a real grid item;
 * never visually hide a whole cell (an `sr-only` cell collapses and shifts every column after it).
 */
export function HeaderCells({
  columns = LIBRARY_TABLE_COLUMNS,
  sort,
  dir,
  onSort,
  allSelected,
  someSelected,
  onToggleAll,
  headerFilters,
}: {
  columns?: readonly LibraryColumn[];
  sort: LibrarySortKey;
  dir: LibrarySortDir;
  onSort: (sort: LibrarySortKey, dir: LibrarySortDir) => void;
  allSelected: boolean;
  someSelected: boolean;
  onToggleAll: () => void;
  headerFilters?: LibraryHeaderFilterProps;
}) {
  const offsets = libraryPinnedOffsets(columns);
  return (
    <>
      {columns.map((c) => {
        const sortKey = c.sort;
        const active = Boolean(sortKey && sort === sortKey);
        return (
          <div
            key={c.id}
            role="columnheader"
            aria-sort={sortKey ? active ? (dir === "asc" ? "ascending" : "descending") : "none" : undefined}
            data-column={c.id}
            data-pinned={Boolean(c.pinned)}
            style={{ left: offsets.get(c.id) }}
            className={[styles.cell, "group", alignClass(c)].join(" ")}
            title={c.id === "originality" ? "Originality" : c.label || undefined}
          >
            {c.id === "select" ? <SelectBox checked={allSelected} indeterminate={someSelected && !allSelected} label="Select all shown releases" onClick={() => onToggleAll()} />
              : c.id === "cover" ? <span className="sr-only">Cover</span>
              : <div className="flex min-w-0 items-center gap-0.5">
            {sortKey ? <button
              type="button"
              className={[
                "inline-flex min-w-0 flex-1 items-center gap-0.5 uppercase tracking-wider focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sb-accent)]",
                c.align === "right" ? "justify-end" : "",
              ].join(" ")}
              style={active ? { color: "var(--sb-text)" } : undefined}
              onClick={() => onSort(sortKey, active ? (dir === "asc" ? "desc" : "asc") : defaultSortDir(sortKey))}
            >
              <span className="truncate">{c.label}</span>
              {active ? dir === "asc" ? <ArrowUp className="h-3 w-3 flex-none" /> : <ArrowDown className="h-3 w-3 flex-none" /> : null}
            </button> : <span className="min-w-0 flex-1 truncate">{c.label}</span>}
            {headerFilters ? <LibraryHeaderFilter column={c} {...headerFilters} /> : null}
            </div>}
          </div>
        );
      })}
    </>
  );
}

/** One cell per column, in the same order as `HeaderCells`. */
export function RowCells({
  columns = LIBRARY_TABLE_COLUMNS,
  row,
  entityNames,
  checked,
  onToggle,
}: {
  columns?: readonly LibraryColumn[];
  row: LibraryRow;
  entityNames: Map<string, string>;
  checked: boolean;
  onToggle: (shift: boolean) => void;
}) {
  const artist = row.sheet_artist;
  const title = row.sheet_title;
  const entityName = row.entity ? (entityNames.get(row.entity) ?? row.entity.toUpperCase()) : "";
  const offsets = libraryPinnedOffsets(columns);

  const render = (c: LibraryColumn): ReactNode => {
    switch (c.id) {
      case "select":
        return (
          <div className="flex items-center">
            <SelectBox checked={checked} label={`Select ${artist ?? ""} ${title ?? row.catalog_id}`.trim()} onClick={onToggle} />
          </div>
        );
      case "cover":
        return row.album_image_url ? <LibraryCover url={row.album_image_url} size={20} /> : null;
      case "release":
        return (
          <span className="truncate whitespace-nowrap tabular-nums" title={row.release_date ? formatReleaseDate(row.release_date) : undefined}>{row.release_date ? formatReleaseDate(row.release_date) : <Dash />}</span>
        );
      case "artist":
        return (
          <div className="font-medium">
            <Cell value={artist} />
          </div>
        );
      case "title":
        return <Cell value={title} />;
      case "originality":
        return <OriginalityIcon row={row} />;
      case "entity":
        return <EntityBadge code={row.entity} name={entityName} />;
      case "distributor":
        return <Cell value={row.distributor_account} />;
      case "labelGenre":
        return <Cell value={row.label_genre} />;
      case "comment1":
        return <Cell value={row.comment_1} muted />;
      case "comment2":
        return <Cell value={row.comment_2} muted />;
      case "uniqode":
      case "evenfall":
        return <LibraryLicensingBadge licensing={row.licensing} licensee={c.id} />;
      case "isrc":
        return <Cell value={row.isrc} mono />;
      case "upc":
        return <Cell value={row.upc} mono />;
      case "streams":
        return <StreamsCell value={row.total_streams} />;
      case "streams7d":
        return <StreamsCell value={row.streams_7d} />;
      case "length":
        return row.master_duration_s !== null ? <span className="tabular-nums">{formatDuration(row.master_duration_s)}</span> : <Dash />;
      case "master":
        return row.has_m_master ? (
          <Check className="inline h-3.5 w-3.5" style={{ color: "var(--sb-positive)" }} aria-label="Has master" />
        ) : (
          <Dash />
        );
      case "drive":
        return (
          <span className="inline-flex items-center justify-center gap-1.5">
            {row.source_folder ? <Folder className="h-3.5 w-3.5" style={{ color: "var(--sb-muted)" }} aria-label="On drive" /> : null}
            {row.dropbox_link ? (
              <ExternalLink className="h-3 w-3" style={{ color: "var(--sb-muted)" }} aria-label="Has Dropbox link" />
            ) : null}
            {!row.source_folder && !row.dropbox_link ? <Dash /> : null}
          </span>
        );
      case "catalog":
        return (
          <span className="block truncate font-mono text-[11px]" style={{ color: "var(--sb-muted)" }} title={row.catalog_id}>
            {row.catalog_id}
          </span>
        );
    }
  };

  return (
    <>
      {columns.map((c) => (
        <div key={c.id} role="cell" data-column={c.id} data-pinned={Boolean(c.pinned)} style={{ left: offsets.get(c.id) }} className={[styles.cell, alignClass(c)].join(" ")}>
          {render(c)}
        </div>
      ))}
    </>
  );
}
