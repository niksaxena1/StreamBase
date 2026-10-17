"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef, type RefObject } from "react";

import { LIBRARY_GRID_COLUMNS, LIBRARY_TABLE_MIN_WIDTH } from "@/lib/library/columns";
import type { LibrarySortDir, LibrarySortKey } from "@/lib/library/filters";
import { useLibraryViewportHeight } from "@/lib/library/useLibraryViewportHeight";
import type { LibraryRow } from "@/lib/library/types";

import { HeaderCells, RowCells } from "./LibraryTableCells";

export { EntityBadge } from "./LibraryTableCells";

const ROW_HEIGHT = 40;

export type LibraryTableSelection = {
  selected: Set<string>;
  onToggle: (index: number, shift: boolean) => void;
  onToggleAll: () => void;
};

export function LibraryTable({
  rows,
  entityNames,
  selectedId,
  onSelect,
  sort,
  dir,
  onSort,
  selection,
  toolbarRef,
}: {
  rows: LibraryRow[];
  entityNames: Map<string, string>;
  selectedId: string | null;
  onSelect: (catalogId: string) => void;
  sort: LibrarySortKey;
  dir: LibrarySortDir;
  onSort: (sort: LibrarySortKey, dir: LibrarySortDir) => void;
  selection: LibraryTableSelection;
  toolbarRef: RefObject<HTMLDivElement | null>;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useLibraryViewportHeight(scrollRef, toolbarRef);
  // TanStack Virtual returns unmemoizable functions; the table is the only thing that uses them.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 14,
  });

  const selectedCount = selection.selected.size;
  const allSelected = rows.length > 0 && rows.every((r) => selection.selected.has(r.catalog_id));

  return (
    <div className="sb-card relative overflow-hidden">
      <div ref={scrollRef} className="min-h-[360px] overflow-auto" style={{ height: 360 }}>
        <div role="table" aria-label="Releases" aria-rowcount={rows.length + 1} style={{ minWidth: LIBRARY_TABLE_MIN_WIDTH }}>
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
            <HeaderCells
              sort={sort}
              dir={dir}
              onSort={onSort}
              allSelected={allSelected}
              someSelected={selectedCount > 0}
              onToggleAll={selection.onToggleAll}
            />
          </div>

          <div role="rowgroup" className="relative" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index];
              const selected = row.catalog_id === selectedId;
              const checked = selection.selected.has(row.catalog_id);
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
                    background: selected || checked ? "var(--sb-accent-10)" : undefined,
                  }}
                >
                  <RowCells
                    row={row}
                    entityNames={entityNames}
                    checked={checked}
                    onToggle={(shift) => selection.onToggle(item.index, shift)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
