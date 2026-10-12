"use client";

import { Library, Plus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { SectionEmptyState } from "@/components/ui/DataStates";
import { downloadCsv } from "@/lib/csv";
import { libraryCsvFilename, libraryCsvRows } from "@/lib/library/exportCsv";
import {
  LIBRARY_FILTER_PARAMS,
  activeFilterCount,
  buildSearchIndex,
  clearLibraryFilters,
  distinctValues,
  entityCounts,
  filterRows,
  parseLibraryFilters,
  releaseYears,
  serializeLibraryFilters,
  sortRows,
  toggleEntity,
  type LibraryFilters,
} from "@/lib/library/filters";
import { mergeRows } from "@/lib/library/normalize";
import {
  LIBRARY_EXCLUSIVITY_OPTIONS,
  LIBRARY_ORIGINALITY_OPTIONS,
  type LibraryDistributor,
  type LibraryEntity,
  type LibraryRow,
} from "@/lib/library/types";

import { AddReleaseModal } from "./AddReleaseModal";
import { LibraryDetailPanel } from "./LibraryDetailPanel";
import { LibraryFilterBar, type FilterOptionLists } from "./LibraryFilters";
import { LibraryTable } from "./LibraryTable";

const formatCount = (n: number) => n.toLocaleString("en-US");

/** Writes the filter state into the address bar without a server round trip. */
function writeFiltersToUrl(filters: LibraryFilters) {
  const url = new URL(window.location.href);
  for (const key of LIBRARY_FILTER_PARAMS) url.searchParams.delete(key);
  for (const [key, value] of serializeLibraryFilters(filters)) url.searchParams.set(key, value);
  const next = `${url.pathname}${url.search}`;
  if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", next);
}

function writeIdToUrl(id: string | null, mode: "push" | "replace") {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("id", id);
  else url.searchParams.delete("id");
  const next = `${url.pathname}${url.search}`;
  if (mode === "push") window.history.pushState(null, "", next);
  else window.history.replaceState(null, "", next);
}

export function LibraryPageClient({
  rows: serverRows,
  entities,
  distributors,
  today,
}: {
  rows: LibraryRow[];
  entities: LibraryEntity[];
  distributors: LibraryDistributor[];
  today: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const openId = searchParams.get("id");

  const [filters, setFilters] = useState<LibraryFilters>(() => parseLibraryFilters(searchParams));
  const [overrides, setOverrides] = useState<Map<string, LibraryRow>>(() => new Map());
  const [addOpen, setAddOpen] = useState(false);

  // Filters live in the URL so a view can be bookmarked or shared. Typing is debounced.
  useEffect(() => {
    const t = window.setTimeout(() => writeFiltersToUrl(filters), 250);
    return () => window.clearTimeout(t);
  }, [filters]);

  const patchFilters = useCallback((patch: Partial<LibraryFilters>) => setFilters((f) => ({ ...f, ...patch })), []);

  const rows = useMemo(() => mergeRows(serverRows, overrides), [serverRows, overrides]);
  const searchIndex = useMemo(() => buildSearchIndex(rows), [rows]);
  const filtered = useMemo(
    () => sortRows(filterRows(rows, filters, today, { searchIndex }), filters.sort, filters.dir),
    [rows, filters, today, searchIndex],
  );
  const counts = useMemo(() => entityCounts(rows, filters, today, searchIndex), [rows, filters, today, searchIndex]);

  const entityNames = useMemo(() => new Map(entities.map((e) => [e.code, e.name])), [entities]);
  const distributorNames = useMemo(() => distributors.map((d) => d.name), [distributors]);

  const options = useMemo<FilterOptionLists>(
    () => ({
      years: releaseYears(rows),
      distributors: distinctValues([...distributorNames, ...rows.map((r) => r.distributor_account)]),
      labelGenres: distinctValues(rows.map((r) => r.label_genre)),
      originalities: distinctValues([...LIBRARY_ORIGINALITY_OPTIONS, ...rows.map((r) => r.originality)]),
      exclusivities: distinctValues([...LIBRARY_EXCLUSIVITY_OPTIONS, ...rows.map((r) => r.exclusivity)]),
    }),
    [rows, distributorNames],
  );

  // One chip per entity that has releases (or is active), plus any code found only in the data.
  const entityChips = useMemo(() => {
    const known = new Set(entities.map((e) => e.code));
    const extra = [...new Set(rows.map((r) => r.entity).filter((c): c is string => Boolean(c) && !known.has(c as string)))];
    return [
      ...entities.map((e) => ({ code: e.code, name: e.name, active: e.active })),
      ...extra.map((code) => ({ code, name: code.toUpperCase(), active: false })),
    ].filter((e) => e.active || (counts.get(e.code) ?? 0) > 0 || filters.entities.includes(e.code));
  }, [entities, rows, counts, filters.entities]);

  const activeCount = activeFilterCount(filters);
  const total = rows.length;
  const selectedRow = openId ? (rows.find((r) => r.catalog_id === openId) ?? null) : null;

  function openPanel(id: string) {
    writeIdToUrl(id, openId ? "replace" : "push");
  }
  const closePanel = useCallback(() => writeIdToUrl(null, "replace"), []);

  function rememberRow(row: LibraryRow | null) {
    if (!row) {
      // The save went through but the fresh row couldn't be read back: reload from the server.
      router.refresh();
      return;
    }
    setOverrides((prev) => new Map(prev).set(row.catalog_id, row));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-lg sb-ring"
          style={{ background: "var(--sb-surface)" }}
        >
          <Library className="h-5 w-5" style={{ color: "var(--sb-accent)" }} />
        </div>
        <div className="min-w-0">
          <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">Library</h1>
          <p className="text-xs" style={{ color: "var(--sb-muted)" }} aria-live="polite">
            {formatCount(total)} {total === 1 ? "release" : "releases"}
            {activeCount > 0 ? ` · ${formatCount(filtered.length)} shown` : ""}
          </p>
        </div>
        <Button
          className="ml-auto"
          variant="accent"
          leftIcon={<Plus className="h-3.5 w-3.5" />}
          onClick={() => setAddOpen(true)}
        >
          Add release
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by entity">
        <Chip selected={filters.entities.length === 0} onClick={() => patchFilters({ entities: [] })}>
          All
          <span className="tabular-nums opacity-70">{formatCount(Array.from(counts.values()).reduce((a, b) => a + b, 0))}</span>
        </Chip>
        {entityChips.map((e) => (
          <Chip
            key={e.code}
            selected={filters.entities.includes(e.code)}
            onClick={() => patchFilters({ entities: toggleEntity(filters.entities, e.code) })}
          >
            {e.name}
            <span className="tabular-nums opacity-70">{formatCount(counts.get(e.code) ?? 0)}</span>
          </Chip>
        ))}
      </div>

      <LibraryFilterBar
        filters={filters}
        options={options}
        activeCount={activeCount}
        onChange={patchFilters}
        onClear={() => setFilters(clearLibraryFilters)}
        onExport={() => downloadCsv({ filename: libraryCsvFilename(today), rows: libraryCsvRows(filtered), sortForExport: false })}
        exportDisabled={filtered.length === 0}
      />

      {filtered.length === 0 ? (
        <SectionEmptyState
          title="No releases match these filters"
          description="Try fewer filters or a different search."
          icon={<Library className="h-5 w-5" />}
          action={
            activeCount > 0 ? (
              <Button variant="secondary" onClick={() => setFilters(clearLibraryFilters)}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <LibraryTable rows={filtered} entityNames={entityNames} selectedId={openId} onSelect={openPanel} />
      )}

      {openId ? (
        <LibraryDetailPanel
          key={openId}
          catalogId={openId}
          row={selectedRow}
          entities={entities}
          distributors={distributorNames}
          onClose={closePanel}
          onSaved={rememberRow}
        />
      ) : null}

      <AddReleaseModal
        open={addOpen}
        entities={entities}
        distributors={distributorNames}
        onClose={() => setAddOpen(false)}
        onCreated={(catalogId, row) => {
          rememberRow(row);
          setAddOpen(false);
          openPanel(catalogId);
        }}
      />
    </div>
  );
}
