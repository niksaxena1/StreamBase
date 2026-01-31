"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect } from "react";
import { formatDateISO } from "@/lib/format";
import { DateRangePicker } from "@/components/ui/DateRangePicker";

const RANGE_CHOICES = [30, 90, 365] as const;
const METRICS = ["streams", "revenue", "tracks"] as const;
type Metric = (typeof METRICS)[number];

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
  }, [metric, searchParams, router]);

  const sp = searchParams ? Object.fromEntries(searchParams) : {};

  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">Collectors</h1>
        <p className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
          Latest data date:{" "}
          <span className="font-mono">
            {latestDataDate ? formatDateISO(latestDataDate) : "—"}
          </span>
        </p>
      </div>
      <div className="flex items-center gap-2">
        {/* Metric selector */}
        <div className="sb-ring flex items-center gap-0.5 rounded-full bg-white/70 p-0.5 dark:bg-white/10">
          {METRICS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMetric(m)}
              className={[
                "rounded-full px-2.5 py-1.5 text-[11px] font-medium transition",
                metric === m
                  ? "bg-black text-white shadow-sm dark:bg-white dark:text-black"
                  : "hover:bg-white/70 dark:hover:bg-white/10",
              ].join(" ")}
              style={metric === m ? undefined : { color: "var(--sb-muted)" }}
            >
              {m === "revenue" ? "Revenue" : m === "streams" ? "Streams" : "Tracks"}
            </button>
          ))}
        </div>

        {/* Range selector */}
        <div className="sb-ring flex items-center gap-0.5 rounded-full bg-white/70 p-0.5 text-[11px] dark:bg-white/10">
          {RANGE_CHOICES.map((d) => (
            <Link
              key={d}
              href={`?collector=${encodeURIComponent(selectedCollector)}&range=${d}`}
              className={[
                "rounded-full px-2.5 py-1.5 font-medium transition",
                rangeDays === d && !sp.start && !sp.end
                  ? "bg-black text-white shadow-sm dark:bg-white dark:text-black"
                  : "hover:bg-white/70 dark:hover:bg-white/10",
              ].join(" ")}
              style={rangeDays === d && !sp.start && !sp.end ? undefined : { color: "var(--sb-muted)" }}
            >
              {d}d
            </Link>
          ))}
        </div>

        {/* Date picker */}
        <DateRangePicker latestDate={latestDataDate ?? null} currentRangeDays={rangeDays} />
      </div>
    </div>
  );
}
