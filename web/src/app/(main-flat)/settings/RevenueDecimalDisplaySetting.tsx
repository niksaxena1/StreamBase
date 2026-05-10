"use client";

import { Chip, ChipGroup } from "@/components/ui/Chip";
import { useRevenueDecimalDisplay } from "@/components/revenue/RevenueDecimalDisplayContext";

export function RevenueDecimalDisplaySetting() {
  const { revenueDecimalDisplayMode, setRevenueDecimalDisplayMode } = useRevenueDecimalDisplay();

  return (
    <div className="sb-ring rounded-2xl bg-white/70 p-3 dark:bg-white/5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <h3 className="text-sm font-medium">Revenue decimals</h3>
          <p className="mt-1 text-xs opacity-70">
            Show, mute, or hide the cents portion of revenue values so whole-dollar amounts are easier to scan.
          </p>
        </div>
        <div className="text-[10px] opacity-60">Saved per user</div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ChipGroup segmented className="text-[11px]">
          <Chip
            segmented
            selected={revenueDecimalDisplayMode === "normal"}
            onClick={() => setRevenueDecimalDisplayMode("normal")}
            title="Show revenue decimals normally"
          >
            Show
          </Chip>
          <Chip
            segmented
            selected={revenueDecimalDisplayMode === "muted"}
            onClick={() => setRevenueDecimalDisplayMode("muted")}
            title="Mute the period and cents in revenue values"
          >
            Muted
          </Chip>
          <Chip
            segmented
            selected={revenueDecimalDisplayMode === "hidden"}
            onClick={() => setRevenueDecimalDisplayMode("hidden")}
            title="Hide the period and cents in revenue values"
          >
            Hidden
          </Chip>
        </ChipGroup>
        <span className="text-xs tabular-nums" style={{ color: "var(--sb-muted)" }}>
          Preview: $12,345<span className="sb-revenue-decimal-part">.67</span>
        </span>
      </div>
    </div>
  );
}
