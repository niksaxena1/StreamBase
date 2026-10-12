"use client";

import { ArrowDown, ArrowUp, Download, Search } from "lucide-react";
import { useState } from "react";

import { Button, IconButton } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { FilterBar } from "@/components/ui/FilterBar";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import {
  LIBRARY_SORT_KEYS,
  LIBRARY_SORT_LABELS,
  defaultSortDir,
  type LibraryFilters as Filters,
  type LibrarySortKey,
} from "@/lib/library/filters";
import { formatDuration, parseDuration } from "@/lib/library/format";

export type FilterOptionLists = {
  years: string[];
  distributors: string[];
  labelGenres: string[];
  originalities: string[];
  exclusivities: string[];
};

const SELECT_CLASS = "w-auto min-w-[8.5rem] max-w-[13rem] py-1.5 text-xs";

function FacetSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  // Keep a value from the URL selectable even if no row has it any more.
  const list = value && !options.includes(value) ? [value, ...options] : options;
  return (
    <Select aria-label={label} className={SELECT_CLASS} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{label}</option>
      {list.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </Select>
  );
}

function DurationField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (seconds: number | null) => void;
}) {
  const [text, setText] = useState(formatDuration(value));
  const [seenValue, setSeenValue] = useState(value);
  // Follow outside changes (e.g. Clear filters) without fighting what the user is typing.
  if (value !== seenValue) {
    setSeenValue(value);
    if (parseDuration(text) !== value) setText(formatDuration(value));
  }
  const invalid = text.trim() !== "" && parseDuration(text) === null;
  return (
    <Input
      aria-label={label}
      aria-invalid={invalid || undefined}
      placeholder={label}
      inputMode="numeric"
      className="w-[5.5rem] py-1.5 text-xs"
      value={text}
      style={invalid ? { borderColor: "var(--sb-error)" } : undefined}
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        if (next.trim() === "") onChange(null);
        else {
          const parsed = parseDuration(next);
          if (parsed !== null) onChange(parsed);
        }
      }}
    />
  );
}

export function LibraryFilterBar({
  filters,
  options,
  activeCount,
  onChange,
  onClear,
  onExport,
  exportDisabled,
}: {
  filters: Filters;
  options: FilterOptionLists;
  activeCount: number;
  onChange: (patch: Partial<Filters>) => void;
  onClear: () => void;
  onExport: () => void;
  exportDisabled: boolean;
}) {
  return (
    <FilterBar
      variant="neutral"
      className="!static"
      left={
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full min-w-[220px] sm:w-72">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
                style={{ color: "var(--sb-muted)" }}
                aria-hidden="true"
              />
              <Input
                type="search"
                aria-label="Search releases"
                placeholder="Search artist, title, ID, ISRC, UPC…"
                className="py-1.5 pl-8 text-xs"
                value={filters.q}
                onChange={(e) => onChange({ q: e.target.value })}
              />
            </div>
            <FacetSelect label="Year" value={filters.year} options={options.years} onChange={(year) => onChange({ year })} />
            <FacetSelect
              label="Distributor"
              value={filters.distributor}
              options={options.distributors}
              onChange={(distributor) => onChange({ distributor })}
            />
            <FacetSelect
              label="Label / Genre"
              value={filters.labelGenre}
              options={options.labelGenres}
              onChange={(labelGenre) => onChange({ labelGenre })}
            />
            <FacetSelect
              label="Originality"
              value={filters.originality}
              options={options.originalities}
              onChange={(originality) => onChange({ originality })}
            />
            <FacetSelect
              label="Exclusivity"
              value={filters.exclusivity}
              options={options.exclusivities}
              onChange={(exclusivity) => onChange({ exclusivity })}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Chip selected={filters.upcoming} onClick={() => onChange({ upcoming: !filters.upcoming })}>
              Upcoming
            </Chip>
            <Chip selected={filters.released} onClick={() => onChange({ released: !filters.released })}>
              Released
            </Chip>
            <Chip selected={filters.hasMaster} onClick={() => onChange({ hasMaster: !filters.hasMaster })}>
              Has master
            </Chip>
            <Chip selected={filters.missingIsrc} onClick={() => onChange({ missingIsrc: !filters.missingIsrc })}>
              Missing ISRC
            </Chip>
            <Chip selected={filters.missingUpc} onClick={() => onChange({ missingUpc: !filters.missingUpc })}>
              Missing UPC
            </Chip>
            <Chip selected={filters.onDrive} onClick={() => onChange({ onDrive: !filters.onDrive })}>
              On drive
            </Chip>
            <Chip selected={filters.splice} onClick={() => onChange({ splice: !filters.splice })}>
              Splice samples
            </Chip>

            <span className="ml-1 flex items-center gap-1.5 text-[11px]" style={{ color: "var(--sb-muted)" }}>
              Length
              <DurationField label="Min m:ss" value={filters.minDuration} onChange={(minDuration) => onChange({ minDuration })} />
              to
              <DurationField label="Max m:ss" value={filters.maxDuration} onChange={(maxDuration) => onChange({ maxDuration })} />
            </span>

            {activeCount > 0 ? (
              <Button variant="ghost" size="sm" onClick={onClear}>
                Clear filters
              </Button>
            ) : null}
          </div>
        </div>
      }
      right={
        <>
          <Select
            aria-label="Sort by"
            className="w-auto py-1.5 text-xs"
            value={filters.sort}
            onChange={(e) => {
              const sort = e.target.value as LibrarySortKey;
              onChange({ sort, dir: defaultSortDir(sort) });
            }}
          >
            {LIBRARY_SORT_KEYS.map((key) => (
              <option key={key} value={key}>
                {LIBRARY_SORT_LABELS[key]}
              </option>
            ))}
          </Select>
          <IconButton
            variant="secondary"
            aria-label={filters.dir === "asc" ? "Sorted ascending, switch to descending" : "Sorted descending, switch to ascending"}
            onClick={() => onChange({ dir: filters.dir === "asc" ? "desc" : "asc" })}
          >
            {filters.dir === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
          </IconButton>
          <Button
            variant="secondary"
            leftIcon={<Download className="h-3.5 w-3.5" />}
            onClick={onExport}
            disabled={exportDisabled}
          >
            Export CSV
          </Button>
        </>
      }
    />
  );
}
