"use client";

import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";

import { formatMonthLong } from "./collectorsUtils";

export function CollectorForecastModal({
  open,
  onClose,
  selectedCollector,
  forecastMonth,
  forecastValue,
  setForecastValue,
  forecastError,
  forecastSaving,
  onSave,
  onClear,
}: {
  open: boolean;
  onClose: () => void;
  selectedCollector: string;
  forecastMonth: string | null;
  forecastValue: string;
  setForecastValue: (v: string) => void;
  forecastError: string | null;
  forecastSaving: boolean;
  onSave: (month: string, amount: number) => void;
  onClear: (month: string) => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Actual revenue"
      subtitle={
        forecastMonth ? (
          <span>
            {selectedCollector} &bull; {formatMonthLong(forecastMonth)}
          </span>
        ) : (
          <span>{selectedCollector}</span>
        )
      }
      maxWidthClassName="max-w-lg"
    >
      <div className="space-y-3">
        <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
          Set the actual revenue for this month (USD). This is shown as a diamond
          marker on the chart (when enabled).
        </div>

        <div className="space-y-1">
          <div
            className="text-xs font-medium"
            style={{ color: "var(--sb-text)" }}
          >
            Amount (USD)
          </div>
          <Input
            type="text"
            inputMode="decimal"
            value={forecastValue}
            onChange={(e) => setForecastValue(e.target.value)}
            placeholder="e.g. 1234.56"
            className="text-sm"
          />
        </div>

        {forecastError ? (
          <div className="text-xs text-red-600 dark:text-red-400">
            {forecastError}
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            className="sb-ring rounded-full bg-white/60 px-3 py-2 text-xs font-medium hover:bg-white/80 dark:bg-white/10 dark:hover:bg-white/15"
            style={{ color: "var(--sb-text)" }}
            disabled={forecastSaving || !forecastMonth}
            onClick={() => {
              if (forecastMonth) onClear(forecastMonth);
            }}
            title="Clear actual revenue for this month"
          >
            Clear
          </button>
          <button
            type="button"
            className="sb-ring rounded-full bg-black px-4 py-2 text-xs font-medium text-white hover:bg-black/90 disabled:opacity-60 disabled:hover:bg-black dark:bg-white dark:text-black dark:hover:bg-white/90"
            disabled={forecastSaving || !forecastMonth}
            onClick={() => {
              if (!forecastMonth) return;
              const raw = forecastValue.trim();
              const cleaned = raw.replace(/[$,]/g, "");
              const n = Number(cleaned);
              if (!cleaned) {
                // Let the parent set the error
                return;
              }
              if (!Number.isFinite(n) || n < 0) {
                return;
              }
              onSave(forecastMonth, n);
            }}
            title="Save actual revenue"
          >
            {forecastSaving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
