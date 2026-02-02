"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { PageHeader } from "@/components/shell/PageHeader";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { formatDateISO } from "@/lib/format";
import { hrefWithPatchedSearchParams } from "@/lib/searchParams";
import { Chip, ChipGroup } from "@/components/ui/Chip";

const RANGE_CHOICES = [30, 90, 365] as const;

export function CollectorsPageHeader({
  selectedCollector,
  rangeDays,
  latestDataDate,
}: {
  selectedCollector: string;
  rangeDays: number;
  latestDataDate: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Keep URL clean: remove legacy `metric` query param if present.
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (!params.has("metric")) return;
    params.delete("metric");
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [searchParams, router]);

  const sp = searchParams ? Object.fromEntries(searchParams) : {};

  function chipLinkClass(active: boolean) {
    return [
      "rounded-full px-2.5 py-1.5 text-[11px] font-medium transition",
      active
        ? "bg-black text-white shadow-sm dark:bg-white dark:text-black"
        : "text-black/70 hover:bg-black/5 dark:text-white/70 dark:hover:bg-white/10",
    ].join(" ");
  }

  return (
    <PageHeader
      title="Collectors"
      subtitle={
        <>
          Latest data date:{" "}
          <span className="font-mono">
            {latestDataDate ? formatDateISO(latestDataDate) : "—"}
          </span>
        </>
      }
      actions={
        <>
          {/* Range selector */}
          <ChipGroup segmented className="text-[11px]">
            {RANGE_CHOICES.map((d) => (
              <Link
                key={d}
                href={hrefWithPatchedSearchParams(searchParams, {
                  collector: selectedCollector,
                  range: String(d),
                  start: null,
                  end: null,
                })}
                className={chipLinkClass(rangeDays === d && !sp.start && !sp.end)}
              >
                {d}d
              </Link>
            ))}
          </ChipGroup>

          {/* Date picker */}
          <DateRangePicker latestDate={latestDataDate ?? null} currentRangeDays={rangeDays} tone="opaque" />
        </>
      }
    />
  );
}
