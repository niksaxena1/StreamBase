"use client";

import { useWeekendDip } from "@/components/charts/WeekendDipContext";

export function WeekendDipSetting() {
  const { showWeekendDip, setShowWeekendDip } = useWeekendDip();

  return (
    <div className="sb-ring rounded-2xl bg-white/70 p-3 dark:bg-white/5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1">
          <h3 className="text-sm font-medium">Weekend dip labels</h3>
          <p className="mt-1 text-xs opacity-70">
            Show a small percentage above Saturday &amp; Sunday dots indicating how much streams dipped compared to the Mon–Fri average.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowWeekendDip(!showWeekendDip)}
          className={[
            "sb-ring relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
            showWeekendDip ? "bg-black dark:bg-white" : "bg-black/20 dark:bg-white/20",
          ].join(" ")}
          aria-label={showWeekendDip ? "Disable weekend dip labels" : "Enable weekend dip labels"}
        >
          <span
            className={[
              "inline-block h-4 w-4 transform rounded-full bg-white dark:bg-black transition-transform",
              showWeekendDip ? "translate-x-6" : "translate-x-1",
            ].join(" ")}
          />
        </button>
      </div>
    </div>
  );
}
