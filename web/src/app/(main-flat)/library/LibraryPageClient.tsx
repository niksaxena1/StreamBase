"use client";

import { Download, Library, Plus, Search, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Alert } from "@/components/ui/Alert";
import { Button, IconButton } from "@/components/ui/Button";
import { Chip, ChipGroup } from "@/components/ui/Chip";
import { SectionEmptyState } from "@/components/ui/DataStates";
import { Input } from "@/components/ui/Input";
import { activeLibraryFilterChips } from "@/lib/library/activeFilterChips";
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
import { useLibraryColumns } from "@/lib/library/useLibraryColumns";
import { visibleLibraryColumns } from "@/lib/library/columns";
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
import { LibraryColumnPicker } from "./LibraryColumnPicker";
import { LibraryDetailPanel } from "./LibraryDetailPanel";
import { FacetSelect, LibraryFilterBar, type FilterOptionLists } from "./LibraryFilters";
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
  const toolbarRef = useRef<HTMLDivElement>(null);
  const { hidden, setHidden } = useLibraryColumns();
  const columns = useMemo(() => visibleLibraryColumns(hidden), [hidden]);
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
  const filterChips = activeLibraryFilterChips(filters);
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
      setOverrides(new Map());
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
    // Batch status changes do not advance tracks.updated_at; discard earlier edit overlays before refreshing.
    setOverrides(new Map());
    setNotice(`Updated ${formatCount(updated)} ${updated === 1 ? "release" : "releases"}`);
    router.refresh();
  }

  return (
    <div className="space-y-1">
      <div ref={toolbarRef} className="space-y-1">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="shrink-0 font-display text-lg font-semibold tracking-tight">Library</h1>
          <p className="min-w-0 flex-1 truncate text-[11px]" style={{ color: "var(--sb-muted)" }} aria-live="polite">
            {formatCount(total)} {total === 1 ? "release" : "releases"}
            {` \u00b7 ${formatCount(filtered.length)} shown`}
            {asOf ? ` \u00b7 Streams as of ${formatReleaseDate(asOf)}` : " \u00b7 Stream figures unavailable"}
          </p>
          <ChipGroup segmented aria-label="Layout" className="ml-auto shrink-0">
            <Chip segmented className="px-2 py-1" selected={!isSchedule} onClick={() => setView("list")}>List</Chip>
            <Chip segmented className="px-2 py-1" selected={isSchedule} onClick={() => setView("schedule")}>Schedule</Chip>
          </ChipGroup>
          <Button variant="accent" className="h-7 shrink-0 gap-1 px-2" aria-label="Add release" leftIcon={<Plus className="h-3.5 w-3.5" aria-hidden="true" />} onClick={() => setAddOpen(true)}>
            <span className="hidden sm:inline">Add release</span>
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-1" aria-label="Library toolbar" role="group">
          <div className="relative min-w-[140px] flex-[1_1_150px]">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: "var(--sb-muted)" }} aria-hidden="true" />
            <Input type="search" aria-label="Search releases" placeholder="Search releases..." className="h-7 py-1 pl-7 text-xs" value={filters.q} onChange={(e) => patchFilters({ q: e.target.value })} />
          </div>
          <div className="min-w-0 max-w-full flex-[0_1_auto] overflow-x-auto">
            <ChipGroup segmented aria-label="Filter by entity" className="whitespace-nowrap">
              <Chip segmented className="gap-1 px-2 py-1" selected={filters.entities.length === 0} onClick={() => patchFilters({ entities: [] })}>
                All <span className="tabular-nums opacity-70">{formatCount(Array.from(counts.values()).reduce((a, b) => a + b, 0))}</span>
              </Chip>
              {entityChips.map((e) => (
                <Chip segmented key={e.code} className="gap-1 px-2 py-1" selected={filters.entities.includes(e.code)} onClick={() => patchFilters({ entities: toggleEntity(filters.entities, e.code) })}>
                  {e.name}<span className="tabular-nums opacity-70">{formatCount(counts.get(e.code) ?? 0)}</span>
                </Chip>
              ))}
            </ChipGroup>
          </div>
          <FacetSelect label="Year" value={filters.year} options={options.years} onChange={(year) => patchFilters({ year })} />
          <LibraryFilterBar filters={filters} options={options} activeCount={filterChips.length} onChange={patchFilters} onClear={() => setFilters(resetLibraryFilters)} />
          {!isSchedule ? <LibraryColumnPicker hidden={hidden} onChange={setHidden} /> : null}
          <LibraryAttentionPanel counts={attention} active={filters.attention} onPick={(rule) => setFilters((f) => attentionFilters(f, rule))} />
          <IconButton className="h-7 w-7 shrink-0" aria-label="Export CSV" title="Export CSV" disabled={filtered.length === 0} onClick={() => downloadCsv({ filename: libraryCsvFilename(today), rows: libraryCsvRows(filtered), sortForExport: false })}>
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
          </IconButton>
        </div>

        <LibraryViews filters={filters} today={today} onApply={setFilters} />

        {filterChips.length > 0 ? (
          <div className="flex items-center gap-1 overflow-x-auto whitespace-nowrap" role="group" aria-label="Active filters">
            {filterChips.map((chip) => (
              <Chip key={chip.key} className="shrink-0 gap-1 px-2 py-0.5 text-[10px]" aria-label={`Remove ${chip.label}`} onClick={() => patchFilters(chip.clear)}>
                {chip.label}<X className="h-2.5 w-2.5" aria-hidden="true" />
              </Chip>
            ))}
            <Button size="xs" variant="ghost" className="h-5 shrink-0" onClick={() => setFilters(resetLibraryFilters)}>Clear all</Button>
          </div>
        ) : null}

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
      </div>

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
          columns={columns}
          today={today}
          filters={filters}
          filterOptions={options}
          onFilter={patchFilters}
          toolbarRef={toolbarRef}
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
