"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Calendar, X } from "lucide-react";
import { useState, useEffect } from "react";
import { formatDateISO } from "@/lib/format";

export function DateRangePicker({
  latestDate,
  currentRangeDays,
}: {
  latestDate: string | null;
  currentRangeDays: number;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [isOpen, setIsOpen] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  useEffect(() => {
    if (!latestDate) return;
    // If custom range is active, use it; otherwise sync with currentRangeDays
    const customStart = sp.get("start");
    const customEnd = sp.get("end");
    if (customStart && customEnd) {
      setStartDate(customStart);
      setEndDate(customEnd);
    } else {
      const end = latestDate;
      const start = (() => {
        const d = new Date(`${end}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() - (currentRangeDays - 1));
        return d.toISOString().slice(0, 10);
      })();
      setEndDate(end);
      setStartDate(start);
    }
  }, [latestDate, currentRangeDays, sp]);

  function handleApply() {
    if (!startDate || !endDate) return;
    if (startDate > endDate) {
      const tmp = startDate;
      setStartDate(endDate);
      setEndDate(tmp);
      return;
    }

    const start = new Date(`${startDate}T00:00:00Z`);
    const end = new Date(`${endDate}T00:00:00Z`);
    const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const clampedDays = Math.max(7, Math.min(365, days));

    const params = new URLSearchParams(sp.toString());
    params.set("range", String(clampedDays));
    params.set("start", startDate);
    params.set("end", endDate);
    router.push(`?${params.toString()}`);
    setIsOpen(false);
  }

  function handleClear() {
    const params = new URLSearchParams(sp.toString());
    params.delete("start");
    params.delete("end");
    // Keep the current range days
    router.push(`?${params.toString()}`);
    setIsOpen(false);
  }

  const hasCustomRange = sp.get("start") && sp.get("end");
  const customStart = sp.get("start");
  const customEnd = sp.get("end");

  if (!latestDate) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={[
          "sb-ring flex items-center gap-1.5 rounded-full px-2.5 py-2 text-[11px] font-medium transition",
          isOpen || hasCustomRange
            ? "bg-black text-white shadow-sm dark:bg-white dark:text-black"
            : "bg-white/70 hover:bg-white/70 dark:bg-white/10 dark:hover:bg-white/10",
        ].join(" ")}
        style={isOpen || hasCustomRange ? undefined : { color: "var(--sb-muted)" }}
        title={hasCustomRange ? `${formatDateISO(customStart!)} to ${formatDateISO(customEnd!)}` : "Custom date range"}
      >
        <Calendar
          className={[
            "h-3 w-3",
            isOpen || hasCustomRange ? "text-white dark:text-black" : "",
          ].join(" ")}
        />
        {hasCustomRange ? (
          <span className="font-mono">
            {formatDateISO(customStart!)}–{formatDateISO(customEnd!)}
          </span>
        ) : (
          "Range"
        )}
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-2 w-64 sb-card p-4 shadow-lg">
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium" style={{ color: "var(--sb-text)" }}>
                  Custom date range
                </div>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="sb-ring grid h-6 w-6 place-items-center rounded-full hover:bg-white/10"
                  style={{ color: "var(--sb-muted)" }}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="flex flex-col gap-2.5">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-medium" style={{ color: "var(--sb-muted)" }}>
                    From
                  </label>
                  <div className="sb-ring rounded-xl bg-white/70 px-3 py-2 dark:bg-white/5">
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      max={endDate || latestDate}
                      min={(() => {
                        const d = new Date(`${latestDate}T00:00:00Z`);
                        d.setUTCDate(d.getUTCDate() - 365);
                        return d.toISOString().slice(0, 10);
                      })()}
                      className="w-full bg-transparent text-xs outline-none"
                      style={{ color: "var(--sb-text)" }}
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-medium" style={{ color: "var(--sb-muted)" }}>
                    To
                  </label>
                  <div className="sb-ring rounded-xl bg-white/70 px-3 py-2 dark:bg-white/5">
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      max={latestDate}
                      min={startDate || (() => {
                        const d = new Date(`${latestDate}T00:00:00Z`);
                        d.setUTCDate(d.getUTCDate() - 365);
                        return d.toISOString().slice(0, 10);
                      })()}
                      className="w-full bg-transparent text-xs outline-none"
                      style={{ color: "var(--sb-text)" }}
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleApply}
                  disabled={!startDate || !endDate}
                  className="sb-ring flex-1 rounded-xl bg-black px-3 py-2 text-xs font-medium text-white transition hover:bg-black/90 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-white dark:text-black dark:hover:bg-white/90"
                >
                  Apply
                </button>
                {hasCustomRange && (
                  <button
                    type="button"
                    onClick={handleClear}
                    className="sb-ring rounded-xl bg-white/70 px-3 py-2 text-xs font-medium transition hover:bg-white dark:bg-white/10 dark:hover:bg-white/20"
                    style={{ color: "var(--sb-text)" }}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
