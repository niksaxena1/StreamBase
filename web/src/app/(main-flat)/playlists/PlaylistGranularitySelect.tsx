"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { GranularitySelect, RangeSelect, handleGranularityWithRangeRestore } from "@/components/ui/GranularitySelect";
import type { Granularity } from "@/components/ui/GranularitySelect";
import { useSharedGranularity } from "@/lib/useSharedGranularity";

const STORAGE_KEY = "sb:playlists:granularity";

export function PlaylistHeaderSelects({ rangeDays }: { rangeDays: number }) {
  const [granularity, setGranularityRaw] = useSharedGranularity(STORAGE_KEY);
  const router = useRouter();

  const pushRange = useCallback(
    (range: number) => {
      const params = new URLSearchParams(window.location.search);
      params.set("range", String(range));
      router.push(`/playlists?${params.toString()}`);
    },
    [router],
  );

  const handleGranularityChange = useCallback(
    (g: Granularity) =>
      handleGranularityWithRangeRestore(g, rangeDays, "playlists", setGranularityRaw, pushRange),
    [rangeDays, setGranularityRaw, pushRange],
  );

  return (
    <>
      {granularity === "daily" && (
        <RangeSelect value={rangeDays} onChange={pushRange} />
      )}
      <GranularitySelect value={granularity} onChange={handleGranularityChange} />
    </>
  );
}
