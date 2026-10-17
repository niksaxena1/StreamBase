"use client";

import { SlidersHorizontal } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { LibraryFilters as Filters } from "@/lib/library/filters";
import { formatDuration, parseDuration } from "@/lib/library/format";

import { LibraryToolbarPopover } from "./LibraryToolbarPopover";

export type FilterOptionLists = {
  years: string[];
  distributors: string[];
  labelGenres: string[];
  originalities: string[];
  exclusivities: string[];
};

const SELECT_CLASS = "h-7 w-auto min-w-0 max-w-full !py-1 pl-2 pr-6 text-[11px]";

export function FacetSelect({
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
    <Select aria-label={label} style={{ width: "auto" }} className={SELECT_CLASS} value={value} onChange={(e) => onChange(e.target.value)}>
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
  filters, options, activeCount, onChange, onClear,
}: {
  filters: Filters;
  options: FilterOptionLists;
  activeCount: number;
  onChange: (patch: Partial<Filters>) => void;
  onClear: () => void;
}) {
  return (
    <LibraryToolbarPopover label={`Filters${activeCount ? ` (${activeCount})` : ""}`} trigger={
      <span className="flex items-center gap-1">
        <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
        Filters{activeCount > 0 ? ` (${activeCount})` : ""}
      </span>
    }>
      {() => (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <FacetSelect label="Distributor" value={filters.distributor} options={options.distributors} onChange={(distributor) => onChange({ distributor })} />
            <FacetSelect label="Label / Genre" value={filters.labelGenre} options={options.labelGenres} onChange={(labelGenre) => onChange({ labelGenre })} />
            <FacetSelect label="Originality" value={filters.originality} options={options.originalities} onChange={(originality) => onChange({ originality })} />
            <FacetSelect label="Exclusivity" value={filters.exclusivity} options={options.exclusivities} onChange={(exclusivity) => onChange({ exclusivity })} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {([
              ["upcoming", "Upcoming"], ["released", "Released"], ["hasMaster", "Has master"],
              ["missingIsrc", "Missing ISRC"], ["missingUpc", "Missing UPC"], ["onDrive", "On drive"], ["splice", "Splice samples"],
            ] as const).map(([key, label]) => (
              <Chip key={key} selected={filters[key]} onClick={() => onChange({ [key]: !filters[key] })}>{label}</Chip>
            ))}
          </div>
          <div className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--sb-muted)" }}>
            Length
            <DurationField label="Min m:ss" value={filters.minDuration} onChange={(minDuration) => onChange({ minDuration })} />
            to
            <DurationField label="Max m:ss" value={filters.maxDuration} onChange={(maxDuration) => onChange({ maxDuration })} />
          </div>
          <Button variant="ghost" size="xs" onClick={onClear}>Clear all</Button>
        </div>
      )}
    </LibraryToolbarPopover>
  );
}
