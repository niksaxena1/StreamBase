"use client";

import { useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { GranularitySelect, RangeSelect, handleGranularityWithRangeRestore } from "@/components/ui/GranularitySelect";
import type { Granularity } from "@/components/ui/GranularitySelect";
import { useSharedGranularity } from "@/lib/useSharedGranularity";
import { DateRangePicker, type DateRangePickerHandle } from "@/components/ui/DateRangePicker";

const STORAGE_KEY = "sb:playlists:granularity";

export function PlaylistHeaderSelects({ rangeDays, latestDataDate }: { rangeDays: number; latestDataDate: string | null }) {
  const [granularity, setGranularityRaw] = useSharedGranularity(STORAGE_KEY);
  const router = useRouter();
  const sp = useSearchParams();
  const datePickerRef = useRef<DateRangePickerHandle>(null);
  const hasCustomRange = Boolean(sp?.get("start") && sp?.get("end"));

  const pushRange = useCallback(
    (range: number) => {
      const params = new URLSearchParams(window.location.search);
      params.set("range", String(range));
      params.delete("start");
      params.delete("end");
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
        <>
          <RangeSelect
            value={rangeDays}
            onChange={pushRange}
            onCustom={() => datePickerRef.current?.open()}
            customActive={hasCustomRange}
            customStart={sp?.get("start") ?? null}
            customEnd={sp?.get("end") ?? null}
          />
          <DateRangePicker ref={datePickerRef} latestDate={latestDataDate} currentRangeDays={rangeDays} headless />
        </>
      )}
      <GranularitySelect value={granularity} onChange={handleGranularityChange} />
    </>
  );
}
