"use client";

import { Filter } from "lucide-react";
import { Chip } from "@/components/ui/Chip";
import { Input } from "@/components/ui/Input";
import type { LibraryColumn } from "@/lib/library/columns";
import type { LibraryFilters } from "@/lib/library/filters";
import { LIBRARY_HEADER_FILTERS, libraryHeaderFilterActive } from "@/lib/library/headerFilters";
import { DurationField, FacetSelect, LicensingFilterSelect, type FilterOptionLists } from "./LibraryFilters";
import { LibraryToolbarPopover } from "./LibraryToolbarPopover";

export type LibraryHeaderFilterProps = {
  filters: LibraryFilters;
  options: FilterOptionLists;
  onChange: (patch: Partial<LibraryFilters>) => void;
};

export function LibraryHeaderFilter({ column, filters, options, onChange }: LibraryHeaderFilterProps & { column: LibraryColumn }) {
  if (!LIBRARY_HEADER_FILTERS[column.id]) return null;
  const toggle = (key: "upcoming" | "released" | "splice" | "missingIsrc" | "missingUpc" | "hasMaster" | "onDrive", label: string) => (
    <Chip selected={filters[key]} onClick={() => onChange({ [key]: !filters[key] })}>{label}</Chip>
  );
  return (
    <LibraryToolbarPopover compact active={libraryHeaderFilterActive(column.id, filters)} label={`Filter ${column.label}`} trigger={<Filter className="h-3 w-3" aria-hidden="true" />}>
      {() => (
        <div className="flex flex-wrap items-center gap-2">
          {column.id === "uniqode" || column.id === "evenfall" ? (
            <LicensingFilterSelect label={column.label} value={filters[column.id]} onChange={(value) => onChange({ [column.id]: value })} />
          ) : null}
          {column.id === "release" ? <>
            <FacetSelect label="Year" value={filters.year} options={options.years} onChange={(year) => onChange({ year })} />
            <label className="flex items-center gap-2">Month<Input aria-label="Month" type="month" className="h-7 text-xs" value={filters.month} onChange={(e) => onChange({ month: e.target.value })} /></label>
            {toggle("upcoming", "Upcoming")}{toggle("released", "Released")}
          </> : null}
          {column.id === "distributor" ? <FacetSelect label="Distributor" value={filters.distributor} options={options.distributors} onChange={(distributor) => onChange({ distributor })} /> : null}
          {column.id === "labelGenre" ? <FacetSelect label="Label / Genre" value={filters.labelGenre} options={options.labelGenres} onChange={(labelGenre) => onChange({ labelGenre })} /> : null}
          {column.id === "originality" ? <>
            <FacetSelect label="Originality" value={filters.originality} options={options.originalities} onChange={(originality) => onChange({ originality })} />
            <FacetSelect label="Exclusivity" value={filters.exclusivity} options={options.exclusivities} onChange={(exclusivity) => onChange({ exclusivity })} />
            {toggle("splice", "Splice samples")}
          </> : null}
          {column.id === "isrc" ? toggle("missingIsrc", "Missing ISRC") : null}
          {column.id === "upc" ? toggle("missingUpc", "Missing UPC") : null}
          {column.id === "master" ? toggle("hasMaster", "Has master") : null}
          {column.id === "drive" ? toggle("onDrive", "On drive") : null}
          {column.id === "length" ? <>
            <DurationField label="Min m:ss" value={filters.minDuration} onChange={(minDuration) => onChange({ minDuration })} />
            to<DurationField label="Max m:ss" value={filters.maxDuration} onChange={(maxDuration) => onChange({ maxDuration })} />
          </> : null}
        </div>
      )}
    </LibraryToolbarPopover>
  );
}
