"use client";

import { LoadingState } from "@/components/ui/Skeleton";
import { useSyncCatalogSelection } from "./useSyncCatalogSelection";

const artists: Array<{ id: string }> = [];

/** The empty-server fallback validates memory just like normal bare entries. */
export function RememberedCatalogEmptyEntry() {
  useSyncCatalogSelection("", null, "own", null, artists);
  return <div className="sb-card flex min-h-52 flex-col items-center justify-center gap-1 p-6" aria-busy="true">
    <LoadingState message="If this is your first time, we'll pick the first artist we find." className="py-4" />
  </div>;
}
