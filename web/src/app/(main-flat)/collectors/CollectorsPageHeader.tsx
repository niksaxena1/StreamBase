"use client";

import { useSearchParams } from "next/navigation";
import { useNavigationRouter as useRouter } from "@/components/shell/useNavigationRouter";
import { useCallback, useEffect, useRef } from "react";
import { PageHeader } from "@/components/shell/PageHeader";
import { DateRangePicker, type DateRangePickerHandle } from "@/components/ui/DateRangePicker";
import { RangeSelect, GranularitySelect, type Granularity } from "@/components/ui/GranularitySelect";
import { FreshnessLabel } from "@/components/ui/DataStates";
import { Chip, ChipGroup } from "@/components/ui/Chip";
import { writeStoredString } from "@/lib/storage";
import { STREAMS_BASIS_STORAGE_KEY, type StreamsBasis } from "./collectorsTypes";

const BASIS_OPTIONS: Array<{ value: StreamsBasis; label: string; title: string }> = [
  {
    value: "net",
    label: "Net",
    title: "Today's total minus yesterday's. Tracks moving between collectors count as gains or losses.",
  },
  {
    value: "organic",
    label: "Organic",
    title: "Growth only from tracks in the collector on both days. Tracks moving in or out are ignored.",
  },
];

export function CollectorsPageHeader({
  selectedCollector,
  rangeDays,
  streamsBasis,
  latestDataDate,
  granularity,
  onGranularityChange,
}: {
  selectedCollector: string;
  rangeDays: number;
  streamsBasis: StreamsBasis;
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

  const setBasis = useCallback(
    (basis: StreamsBasis) => {
      writeStoredString(STREAMS_BASIS_STORAGE_KEY, basis);
      const params = new URLSearchParams(searchParams.toString());
      if (basis === "organic") params.set("basis", "organic");
      else params.delete("basis");
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

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
        latestDataDate ? <FreshnessLabel date={latestDataDate} /> : "No data date available"
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
          <ChipGroup segmented aria-label="Daily streams basis">
            {BASIS_OPTIONS.map((o) => (
              <Chip
                key={o.value}
                segmented
                selected={streamsBasis === o.value}
                onClick={() => setBasis(o.value)}
                title={o.title}
              >
                {o.label}
              </Chip>
            ))}
          </ChipGroup>
          <GranularitySelect value={granularity} onChange={onGranularityChange} />
        </>
      }
    />
  );
}
