"use client";

import { Library, Plus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Chip, ChipGroup } from "@/components/ui/Chip";
import { SectionEmptyState } from "@/components/ui/DataStates";
import { downloadCsv } from "@/lib/csv";
import { attentionCounts } from "@/lib/library/attention";
import { libraryCsvFilename, libraryCsvRows } from "@/lib/library/exportCsv";
import {
  activeFilterCount,
  buildSearchIndex,
  distinctValues,
  entityCounts,
  filterRows,
  releaseYears,
  sortRows,
  toggleEntity,
  type LibraryFilters,
  type LibraryViewMode,
} from "@/lib/library/filters";
import { formatReleaseDate } from "@/lib/library/format";
import { mergeRows } from "@/lib/library/normalize";
import {
  pruneSelection,
  toggleAllInSelection,
  toggleInSelection,
  type SelectionState,
} from "@/lib/library/selection";
import { mergeStreams, streamsAsOf } from "@/lib/library/streams";
import {
  LIBRARY_EXCLUSIVITY_OPTIONS,
  LIBRARY_ORIGINALITY_OPTIONS,
  type LibraryDistributor,
  type LibraryEntity,
  type LibraryRow,
  type LibraryStream,
} from "@/lib/library/types";
import {
  applyLibraryUrlState,
  attentionFilters,
  libraryStateAfterNavigation,
  narrowingFilterCount,
  readLibraryUrlState,
  resetLibraryFilters,
} from "@/lib/library/views";

import { AddReleaseModal } from "./AddReleaseModal";
import { LibraryAttentionPanel } from "./LibraryAttentionPanel";
import { LibraryBulkBar } from "./LibraryBulkBar";
import { LibraryDetailPanel } from "./LibraryDetailPanel";
import { LibraryFilterBar, type FilterOptionLists } from "./LibraryFilters";
import { LibrarySchedule } from "./LibrarySchedule";
import { LibraryTable } from "./LibraryTable";
import { LibraryViews } from "./LibraryViews";

/** Chip order; any other entity code follows in the order the database gave. */
const ENTITY_ORDER = ["tg", "p", "n", "legacy", "unassigned"];

const EMPTY_SELECTION: SelectionState = { selected: new Set(), anchor: null };

const formatCount = (n: number) => n.toLocaleString("en-US");

/** Writes the filter state into the address bar without a server round trip. */
function writeFiltersToUrl(filters: LibraryFilters) {
  const search = applyLibraryUrlState(window.location.search, filters);
  if (search !== window.location.search) {
    window.history.replaceState(null, "", `${window.location.pathname}${search}`);
  }
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
  streams,
  today,
}: {
  rows: LibraryRow[];
  entities: LibraryEntity[];
  distributors: LibraryDistributor[];
  streams: LibraryStream[];
  today: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const openId = searchParams.get("id");

  const [filters, setFilters] = useState<LibraryFilters>(() => readLibraryUrlState(searchParams.toString()));
  const [overrides, setOverrides] = useState<Map<string, LibraryRow>>(() => new Map());
  const [addOpen, setAddOpen] = useState(false);
  const [selection, setSelection] = useState<SelectionState>(EMPTY_SELECTION);
  const [notice, setNotice] = useState<string | null>(null);

  // Filters live in the URL so a view can be bookmarked or shared. Typing is debounced.
  useEffect(() => {
    const t = window.setTimeout(() => writeFiltersToUrl(filters), 250);
    return () => window.clearTimeout(t);
  }, [filters]);

  // Back / Forward change the URL without going through our state, so read it back.
  // Our own pushState / replaceState calls don't fire popstate, so this can't loop.
  useEffect(() => {
    function onPopState() {
      setFilters((current) => libraryStateAfterNavigation(current, window.location.search));
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const patchFilters = useCallback((patch: Partial<LibraryFilters>) => setFilters((f) => ({ ...f, ...patch })), []);

  // Edits are layered over the server rows first, then stream figures go on top of the result.
  const rows = useMemo(() => mergeStreams(mergeRows(serverRows, overrides), streams), [serverRows, overrides, streams]);
  const asOf = useMemo(() => streamsAsOf(streams), [streams]);
  const searchIndex = useMemo(() => buildSearchIndex(rows), [rows]);
  const filtered = useMemo(
    () => sortRows(filterRows(rows, filters, today, { searchIndex }), filters.sort, filters.dir),
    [rows, filters, today, searchIndex],
  );
  const counts = useMemo(() => entityCounts(rows, filters, today, searchIndex), [rows, filters, today, searchIndex]);
  const attention = useMemo(() => attentionCounts(rows, today), [rows, today]);

  // Selection only keeps rows that are still shown.
  const orderedIds = useMemo(() => filtered.map((r) => r.catalog_id), [filtered]);
  const visibleIds = useMemo(() => new Set(orderedIds), [orderedIds]);
  const prunedSelected = pruneSelection(selection.selected, visibleIds);
  if (prunedSelected !== selection.selected) setSelection({ selected: prunedSelected, anchor: null });

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
    const rank = (code: string) => {
      const i = ENTITY_ORDER.indexOf(code);
      return i < 0 ? ENTITY_ORDER.length : i;
    };
    return [
      ...entities.map((e) => ({ code: e.code, name: e.name, active: e.active })),
      ...extra.map((code) => ({ code, name: code.toUpperCase(), active: false })),
    ]
      .filter((e) => e.active || (counts.get(e.code) ?? 0) > 0 || filters.entities.includes(e.code))
      .sort((a, b) => rank(a.code) - rank(b.code));
  }, [entities, rows, counts, filters.entities]);

  const activeCount = narrowingFilterCount(filters, activeFilterCount(filters));
  const total = rows.length;
  const selectedRow = openId ? (rows.find((r) => r.catalog_id === openId) ?? null) : null;
  const isSchedule = filters.view === "schedule";
  const selectedIds = useMemo(() => orderedIds.filter((id) => prunedSelected.has(id)), [orderedIds, prunedSelected]);

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

  function setView(view: LibraryViewMode) {
    if (view !== filters.view) setSelection(EMPTY_SELECTION);
    patchFilters({ view });
  }

  function bulkDone(updated: number) {
    setSelection(EMPTY_SELECTION);
    setNotice(`Updated ${formatCount(updated)} ${updated === 1 ? "release" : "releases"}`);
    router.refresh();
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
            {activeCount > 0 || filtered.length !== total ? ` · ${formatCount(filtered.length)} shown` : ""}
            {asOf ? ` · Streams as of ${formatReleaseDate(asOf)}` : " · Stream figures unavailable"}
          </p>
        </div>
        <ChipGroup segmented aria-label="Layout" className="ml-auto">
          <Chip segmented selected={!isSchedule} onClick={() => setView("list")}>
            List
          </Chip>
          <Chip segmented selected={isSchedule} onClick={() => setView("schedule")}>
            Schedule
          </Chip>
        </ChipGroup>
        <Button variant="accent" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAddOpen(true)}>
          Add release
        </Button>
      </div>

      {notice ? (
        <Alert
          variant="success"
          actions={
            <Button size="xs" variant="ghost" onClick={() => setNotice(null)}>
              Dismiss
            </Button>
          }
        >
          {notice}
        </Alert>
      ) : null}

      <LibraryAttentionPanel
        counts={attention}
        active={filters.attention}
        onPick={(rule) => setFilters((f) => attentionFilters(f, rule))}
      />

      <LibraryViews filters={filters} today={today} onApply={setFilters} />

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by entity">
        <Chip selected={filters.entities.length === 0} onClick={() => patchFilters({ entities: [] })}>
          All entities
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
        onClear={() => setFilters(resetLibraryFilters)}
        onExport={() => downloadCsv({ filename: libraryCsvFilename(today), rows: libraryCsvRows(filtered), sortForExport: false })}
        exportDisabled={filtered.length === 0}
      />

      {!isSchedule && selectedIds.length > 0 ? (
        <LibraryBulkBar
          selectedIds={selectedIds}
          entities={entities}
          distributors={distributorNames}
          options={options}
          onClear={() => setSelection(EMPTY_SELECTION)}
          onDone={bulkDone}
        />
      ) : null}

      {filtered.length === 0 ? (
        <SectionEmptyState
          title="No releases match these filters"
          description="Try fewer filters or a different search."
          icon={<Library className="h-5 w-5" />}
          action={
            activeCount > 0 ? (
              <Button variant="secondary" onClick={() => setFilters(resetLibraryFilters)}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : isSchedule ? (
        <LibrarySchedule rows={filtered} today={today} entityNames={entityNames} selectedId={openId} onSelect={openPanel} />
      ) : (
        <LibraryTable
          rows={filtered}
          entityNames={entityNames}
          selectedId={openId}
          onSelect={openPanel}
          sort={filters.sort}
          dir={filters.dir}
          onSort={(sort, dir) => patchFilters({ sort, dir })}
          selection={{
            selected: prunedSelected,
            onToggle: (index, shift) => setSelection((s) => toggleInSelection(s, orderedIds, index, shift)),
            onToggleAll: () => setSelection((s) => toggleAllInSelection(s, orderedIds)),
          }}
        />
      )}

      {openId ? (
        <LibraryDetailPanel
          key={openId}
          catalogId={openId}
          row={selectedRow}
          entities={entities}
          distributors={distributorNames}
          streamsAsOf={asOf}
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
