"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { useLayoutEffect, useMemo, useRef, type RefObject } from "react";

import { libraryGridTemplate, libraryMinWidth, libraryPinnedOffsets, type LibraryColumn } from "@/lib/library/columns";
import type { LibraryFilters, LibrarySortDir, LibrarySortKey } from "@/lib/library/filters";
import { buildLibraryItems, libraryItemHeight, libraryItemOffsets, libraryOpeningOffset, pinnedLibraryMonth, LIBRARY_GROUP_HEIGHT, LIBRARY_HEADER_HEIGHT, LIBRARY_ROW_HEIGHT } from "@/lib/library/tableItems";
import { useLibraryViewportHeight } from "@/lib/library/useLibraryViewportHeight";
import { useLibraryTableWidth } from "@/lib/library/useLibraryTableWidth";
import type { LibraryRow } from "@/lib/library/types";

import type { FilterOptionLists } from "./LibraryFilters";
import { HeaderCells, RowCells } from "./LibraryTableCells";
import styles from "./LibraryTable.module.css";

export { EntityBadge } from "./LibraryTableCells";

export type LibraryTableSelection = {
  selected: Set<string>;
  onToggle: (index: number, shift: boolean) => void;
  onToggleAll: () => void;
};

export function LibraryTable({
  rows, entityNames, selectedId, onSelect, sort, dir, onSort, selection, toolbarRef,
  columns, today, filters, filterOptions, onFilter,
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
  columns: readonly LibraryColumn[];
  today: string;
  filters: LibraryFilters;
  filterOptions: FilterOptionLists;
  onFilter: (patch: Partial<LibraryFilters>) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const previousSort = useRef<string | null>(null);
  useLibraryViewportHeight(scrollRef, toolbarRef);
  const viewportWidth = useLibraryTableWidth(scrollRef);
  const pinnedOffsets = useMemo(() => libraryPinnedOffsets(columns, viewportWidth), [columns, viewportWidth]);
  const items = useMemo(() => buildLibraryItems(rows, sort, dir, today), [rows, sort, dir, today]);
  const offsets = useMemo(() => libraryItemOffsets(items), [items]);
  const decorations = useMemo(() => items.flatMap((item, index) => item.kind !== "row" ? [{ item, offset: offsets[index] }] : []), [items, offsets]);
  const gridTemplateColumns = libraryGridTemplate(columns);
  // TanStack Virtual returns unmemoizable functions; the table is the only thing that uses them.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => items[index].key,
    estimateSize: (index) => libraryItemHeight(items[index]),
    scrollMargin: LIBRARY_HEADER_HEIGHT,
    overscan: 14,
  });

  useLayoutEffect(() => {
    const mode = `${sort}:${dir}`;
    if (previousSort.current === mode) return;
    previousSort.current = mode;
    virtualizer.scrollToOffset(libraryOpeningOffset(items, sort, dir));
  }, [sort, dir, items, virtualizer]);

  const allSelected = rows.length > 0 && rows.every((r) => selection.selected.has(r.catalog_id));
  const top = virtualizer.scrollOffset ?? 0;
  const activeMonth = pinnedLibraryMonth(decorations, top);

  return (
    <div className="sb-card relative overflow-hidden">
      <div ref={scrollRef} className="min-h-[360px] overflow-auto" style={{ height: 360 }}>
        <div role="table" aria-label="Releases" aria-rowcount={rows.length + 1} className={styles.table} style={{ minWidth: libraryMinWidth(columns) }}>
          <div role="row" aria-rowindex={1} className="sticky top-0 z-30 grid items-center text-[10px] font-medium uppercase tracking-wide" style={{ gridTemplateColumns, height: LIBRARY_HEADER_HEIGHT, color: "var(--sb-muted)", background: "var(--library-surface)", boxShadow: "0 1px 0 0 var(--sb-border)" }}>
            <HeaderCells columns={columns} pinnedOffsets={pinnedOffsets} sort={sort} dir={dir} onSort={onSort} allSelected={allSelected} someSelected={selection.selected.size > 0} onToggleAll={selection.onToggleAll} headerFilters={{ filters, options: filterOptions, onChange: onFilter }} />
          </div>

          {activeMonth ? <div aria-hidden="true" className="pointer-events-none sticky z-20 h-0" style={{ top: LIBRARY_HEADER_HEIGHT }}>
            <div className={styles.group} style={{ height: LIBRARY_GROUP_HEIGHT }}><span className={styles.groupLabel}>{activeMonth.label}</span></div>
          </div> : null}

          <div role="rowgroup" className="relative" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((virtual) => {
              const item = items[virtual.index];
              const position = { height: virtual.size, transform: `translateY(${virtual.start - LIBRARY_HEADER_HEIGHT}px)` };
              if (item.kind !== "row") return (
                <div key={item.key} role="presentation" className={`absolute left-0 top-0 w-full ${styles.group} ${item.kind === "today" ? styles.today : ""}`} style={position}>
                  <span className={styles.groupLabel}>{item.label}</span>
                </div>
              );
              const { row, rowIndex } = item;
              const selected = row.catalog_id === selectedId;
              const checked = selection.selected.has(row.catalog_id);
              return (
                <div key={item.key} role="row" aria-rowindex={rowIndex + 2} aria-selected={selected || checked} tabIndex={0}
                  onClick={() => onSelect(row.catalog_id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(row.catalog_id);
                    }
                  }}
                  data-odd={rowIndex % 2 !== 0} data-upcoming={Boolean(row.release_date && row.release_date > today)} data-highlighted={selected || checked}
                  className={`${styles.row} absolute left-0 top-0 grid w-full cursor-pointer items-center whitespace-nowrap text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sb-accent)]`}
                  style={{ ...position, height: LIBRARY_ROW_HEIGHT, gridTemplateColumns }}>
                  <RowCells columns={columns} pinnedOffsets={pinnedOffsets} row={row} entityNames={entityNames} checked={checked} onToggle={(shift) => selection.onToggle(rowIndex, shift)} />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
