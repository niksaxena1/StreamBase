"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, ExternalLink, Folder } from "lucide-react";
import { useRef } from "react";

import { formatDuration, formatReleaseDate } from "@/lib/library/format";
import type { LibraryRow } from "@/lib/library/types";

const ROW_HEIGHT = 36;

/** Shared by the header and every row so columns line up. */
export const LIBRARY_GRID_COLUMNS =
  "104px minmax(140px,1.2fr) minmax(160px,1.6fr) 96px 120px 120px 128px 116px 56px 56px 60px 92px";

const HEADERS: Array<{ label: string; align?: "center" | "right" }> = [
  { label: "Release date" },
  { label: "Artist" },
  { label: "Title" },
  { label: "Entity" },
  { label: "Distributor" },
  { label: "Label / Genre" },
  { label: "ISRC" },
  { label: "UPC" },
  { label: "Length", align: "right" },
  { label: "Master", align: "center" },
  { label: "Drive", align: "center" },
  { label: "Catalog ID" },
];

const MIN_WIDTH_CLASS = "min-w-[1240px]";

function Dash() {
  return (
    <span className="opacity-40" style={{ color: "var(--sb-muted)" }}>
      â€”
    </span>
  );
}

function Cell({ value, mono }: { value: string | null; mono?: boolean }) {
  if (!value || !value.trim()) return <Dash />;
  return (
    <span className={["block truncate", mono ? "font-mono text-[11px]" : ""].join(" ")} title={value}>
      {value}
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

export function LibraryTable({
  rows,
  entityNames,
  selectedId,
  onSelect,
}: {
  rows: LibraryRow[];
  entityNames: Map<string, string>;
  selectedId: string | null;
  onSelect: (catalogId: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // TanStack Virtual returns unmemoizable functions; the table is the only thing that uses them.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 14,
  });

  return (
    <div className="sb-card relative overflow-hidden">
      <div ref={scrollRef} className="h-[calc(100dvh-380px)] min-h-[360px] overflow-auto">
        <div role="table" aria-label="Releases" aria-rowcount={rows.length + 1} className={MIN_WIDTH_CLASS}>
          <div
            role="row"
            className="sticky top-0 z-10 grid items-center gap-x-3 px-3 py-2 text-[11px] font-medium uppercase tracking-wider backdrop-blur-xl"
            style={{
              gridTemplateColumns: LIBRARY_GRID_COLUMNS,
              color: "var(--sb-muted)",
              background: "var(--sb-surface)",
              boxShadow: "0 1px 0 0 var(--sb-border)",
            }}
          >
            {HEADERS.map((h) => (
              <div
                key={h.label}
                role="columnheader"
                className={h.align === "right" ? "text-right" : h.align === "center" ? "text-center" : "text-left"}
              >
                {h.label}
              </div>
            ))}
          </div>

          <div role="rowgroup" className="relative" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index];
              const selected = row.catalog_id === selectedId;
              const entityName = row.entity ? (entityNames.get(row.entity) ?? row.entity.toUpperCase()) : "";
              const artist = row.sheet_artist;
              const title = row.sheet_title;
              return (
                <div
                  key={row.catalog_id}
                  role="row"
                  aria-rowindex={item.index + 2}
                  aria-selected={selected}
                  tabIndex={0}
                  onClick={() => onSelect(row.catalog_id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(row.catalog_id);
                    }
                  }}
                  className={[
                    "sb-table-row absolute left-0 top-0 grid w-full cursor-pointer items-center gap-x-3 px-3 text-xs",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sb-accent)]",
                    // Stripes follow the data index (not DOM order), so they don't flicker while scrolling.
                    item.index % 2 === 0 ? "" : "bg-[var(--sb-row-odd)]",
                    "hover:bg-[var(--sb-row-hover)]",
                  ].join(" ")}
                  style={{
                    gridTemplateColumns: LIBRARY_GRID_COLUMNS,
                    height: ROW_HEIGHT,
                    transform: `translateY(${item.start}px)`,
                    background: selected ? "var(--sb-accent-10)" : undefined,
                  }}
                >
                  <div role="cell" className="whitespace-nowrap tabular-nums">
                    {row.release_date ? formatReleaseDate(row.release_date) : <Dash />}
                  </div>
                  <div role="cell" className="min-w-0 font-medium">
                    <Cell value={artist} />
                  </div>
                  <div role="cell" className="min-w-0">
                    <Cell value={title} />
                  </div>
                  <div role="cell" className="min-w-0">
                    <EntityBadge code={row.entity} name={entityName} />
                  </div>
                  <div role="cell" className="min-w-0">
                    <Cell value={row.distributor_account} />
                  </div>
                  <div role="cell" className="min-w-0">
                    <Cell value={row.label_genre} />
                  </div>
                  <div role="cell" className="min-w-0">
                    <Cell value={row.isrc} mono />
                  </div>
                  <div role="cell" className="min-w-0">
                    <Cell value={row.upc} mono />
                  </div>
                  <div role="cell" className="text-right tabular-nums">
                    {row.master_duration_s !== null ? formatDuration(row.master_duration_s) : <Dash />}
                  </div>
                  <div role="cell" className="flex justify-center">
                    {row.has_m_master ? (
                      <Check className="h-3.5 w-3.5" style={{ color: "var(--sb-positive)" }} aria-label="Has master" />
                    ) : (
                      <Dash />
                    )}
                  </div>
                  <div role="cell" className="flex items-center justify-center gap-1.5">
                    {row.source_folder ? (
                      <Folder className="h-3.5 w-3.5" style={{ color: "var(--sb-muted)" }} aria-label="On drive" />
                    ) : null}
                    {row.dropbox_link ? (
                      <ExternalLink className="h-3 w-3" style={{ color: "var(--sb-muted)" }} aria-label="Has Dropbox link" />
                    ) : null}
                    {!row.source_folder && !row.dropbox_link ? <Dash /> : null}
                  </div>
                  <div role="cell" className="min-w-0">
                    <span
                      className="block truncate font-mono text-[11px]"
                      style={{ color: "var(--sb-muted)" }}
                      title={row.catalog_id}
                    >
                      {row.catalog_id}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
