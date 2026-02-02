"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect } from "react";
import { PageHeader } from "@/components/shell/PageHeader";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { formatDateISO } from "@/lib/format";
import { hrefWithPatchedSearchParams } from "@/lib/searchParams";
import { Chip, ChipGroup } from "@/components/ui/Chip";

const RANGE_CHOICES = [30, 90, 365] as const;
const METRICS = ["streams", "revenue", "tracks"] as const;
type Metric = (typeof METRICS)[number];

const COLLECTORS_HEADER_STORAGE = {
  metric: "sb:collectors:header:metric",
} as const;

function readStoredString(key: string): string | null {
  // NOTE: Client components can still render on the server, so guard `window`.
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStoredString(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore (private mode, disabled storage, etc.)
  }
}

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
  
  const [metric, setMetric] = useState<Metric>(() => {
    const urlMetric = searchParams.get("metric");
    if (urlMetric === "revenue" || urlMetric === "streams" || urlMetric === "tracks") {
      return urlMetric;
    }
    const storedMetric = readStoredString(COLLECTORS_HEADER_STORAGE.metric);
    if (storedMetric === "revenue" || storedMetric === "streams" || storedMetric === "tracks") {
      return storedMetric;
    }
    return "revenue"; // Default to revenue
  });

  // Update URL when metric changes
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("metric", metric);
    
    const newUrl = `?${params.toString()}`;
    if (newUrl !== `?${searchParams.toString()}`) {
      router.replace(newUrl, { scroll: false });
    }
    writeStoredString(COLLECTORS_HEADER_STORAGE.metric, metric);
  }, [metric, searchParams, router]);

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
          {/* Metric selector */}
          <ChipGroup segmented>
            {METRICS.map((m) => (
              <Chip key={m} segmented selected={metric === m} onClick={() => setMetric(m)}>
                {m === "revenue" ? "Revenue" : m === "streams" ? "Streams" : "Tracks"}
              </Chip>
            ))}
          </ChipGroup>

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
          <DateRangePicker latestDate={latestDataDate ?? null} currentRangeDays={rangeDays} />
        </>
      }
    />
  );
}
