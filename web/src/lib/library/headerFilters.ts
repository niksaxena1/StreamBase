import type { LibraryColumnId } from "./columns";
import type { LibraryFilters } from "./filters";

export const LIBRARY_HEADER_FILTERS: Partial<Record<LibraryColumnId, readonly (keyof LibraryFilters)[]>> = {
  release: ["year", "month", "upcoming", "released"],
  distributor: ["distributor"], labelGenre: ["labelGenre"],
  originality: ["originality", "exclusivity", "splice"],
  isrc: ["missingIsrc"], upc: ["missingUpc"],
  length: ["minDuration", "maxDuration"], master: ["hasMaster"], drive: ["onDrive"],
};

export function libraryHeaderFilterActive(id: LibraryColumnId, filters: LibraryFilters): boolean {
  return (LIBRARY_HEADER_FILTERS[id] ?? []).some((key) => {
    const value = filters[key];
    return value !== null && value !== "" && value !== false;
  });
}
