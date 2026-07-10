"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { PageHeader } from "@/components/shell/PageHeader";
import { DateRangePicker, type DateRangePickerHandle } from "@/components/ui/DateRangePicker";
import { RangeSelect, GranularitySelect, type Granularity } from "@/components/ui/GranularitySelect";
import { formatDateISO } from "@/lib/format";
import { FreshnessLabel } from "@/components/ui/DataStates";

export function CollectorsPageHeader({
  selectedCollector,
  rangeDays,
  latestDataDate,
  granularity,
  onGranularityChange,
}: {
  selectedCollector: string;
  rangeDays: number;
  latestDataDate: string | null;
  granularity: Granularity;
  onGranularityChange: (g: Granularity) => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const datePickerRef = useRef<DateRangePickerHandle>(null);
  const hasCustomRange = Boolean(searchParams?.get("start") && searchParams?.get("end"));

  // Keep URL clean: remove legacy `metric` query param if present.
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (!params.has("metric")) return;
    params.delete("metric");
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [searchParams, router]);

  const pushRange = useCallback(
    (range: number) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("range", String(range));
      params.set("collector", selectedCollector);
      params.delete("start");
      params.delete("end");
      router.push(`?${params.toString()}`);
    },
    [router, searchParams, selectedCollector],
  );

  return (
    <PageHeader
      title="Collectors"
      subtitle={
        latestDataDate ? <FreshnessLabel date={formatDateISO(latestDataDate)} /> : "No data date available"
      }
      actions={
        <>
          {granularity === "daily" && (
            <>
              <RangeSelect
                value={rangeDays}
                onChange={pushRange}
                onCustom={() => datePickerRef.current?.open()}
                customActive={hasCustomRange}
                customStart={searchParams?.get("start") ?? null}
                customEnd={searchParams?.get("end") ?? null}
              />
              <DateRangePicker ref={datePickerRef} latestDate={latestDataDate ?? null} currentRangeDays={rangeDays} headless />
            </>
          )}
          <GranularitySelect value={granularity} onChange={onGranularityChange} />
        </>
      }
    />
  );
}
