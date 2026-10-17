import { LIBRARY_ATTENTION_LABELS } from "./attention";
import type { LibraryFilters } from "./filters";
import { formatDuration } from "./format";

export type LibraryFilterChip = {
  key: keyof LibraryFilters;
  label: string;
  clear: Partial<LibraryFilters>;
};

/** Visible facets beyond the toolbar's search/entity/year. Each removal clears only its own facet. */
export function activeLibraryFilterChips(filters: LibraryFilters): LibraryFilterChip[] {
  const chips: LibraryFilterChip[] = [];
  const facets = [
    ["distributor", "Distributor"], ["labelGenre", "Label / Genre"],
    ["originality", "Originality"], ["exclusivity", "Exclusivity"], ["month", "Month"],
  ] as const;
  for (const [key, label] of facets) {
    if (filters[key]) chips.push({ key, label: `${label}: ${filters[key]}`, clear: { [key]: "" } });
  }
  const flags = [
    ["upcoming", "Upcoming"], ["released", "Released"], ["hasMaster", "Has master"],
    ["missingIsrc", "Missing ISRC"], ["missingUpc", "Missing UPC"], ["onDrive", "On drive"],
    ["splice", "Splice samples"], ["missingCode", "Missing codes"],
  ] as const;
  for (const [key, label] of flags) {
    if (filters[key]) chips.push({ key, label, clear: { [key]: false } });
  }
  if (filters.minDuration !== null) {
    chips.push({ key: "minDuration", label: `Length \u2265 ${formatDuration(filters.minDuration)}`, clear: { minDuration: null } });
  }
  if (filters.maxDuration !== null) {
    chips.push({ key: "maxDuration", label: `Length \u2264 ${formatDuration(filters.maxDuration)}`, clear: { maxDuration: null } });
  }
  if (filters.attention) {
    chips.push({ key: "attention", label: `Attention: ${LIBRARY_ATTENTION_LABELS[filters.attention]}`, clear: { attention: "" } });
  }
  return chips;
}
