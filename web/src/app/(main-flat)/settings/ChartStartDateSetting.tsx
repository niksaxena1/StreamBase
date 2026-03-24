"use client";

import { useEffect, useMemo, useState } from "react";

import { DEFAULT_CHART_START_DATE_ISO, normalizeIsoDateOrNull } from "@/components/charts/chartUtils";
import { fetchApiJson } from "@/lib/api";
import { SAVED_FEEDBACK_MS } from "@/lib/constants";

type ChartStartDatePayload = {
  chart_start_date: string | null;
  configured?: boolean;
};

export function ChartStartDateSetting() {
  const [dateText, setDateText] = useState<string>(DEFAULT_CHART_START_DATE_ISO);
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const parsed = useMemo(() => {
    const norm = normalizeIsoDateOrNull(dateText);
    return norm ? { ok: true as const, value: norm } : { ok: false as const, error: "Use YYYY-MM-DD." };
  }, [dateText]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    void fetchApiJson<ChartStartDatePayload>("/api/user-settings/chart-start-date")
      .then((data) => {
        const d = normalizeIsoDateOrNull(data.chart_start_date) ?? DEFAULT_CHART_START_DATE_ISO;
        setDateText(d);
        setConfigured(data.configured !== false);
        setLoading(false);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Failed to load setting");
        setLoading(false);
      });
  }, []);

  async function save(nextDate: string | null) {
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const data = await fetchApiJson<ChartStartDatePayload>("/api/user-settings/chart-start-date", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chart_start_date: nextDate }),
      });

      const savedDate = normalizeIsoDateOrNull(data.chart_start_date) ?? DEFAULT_CHART_START_DATE_ISO;
      setDateText(savedDate);
      setSaved(true);
      setTimeout(() => setSaved(false), SAVED_FEEDBACK_MS);

      // Let charts update without a full reload (best-effort).
      window.dispatchEvent(new Event("sb:chart-start-date-updated"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update setting");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="sb-ring rounded-2xl bg-white/70 p-3 dark:bg-white/5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <h3 className="text-sm font-medium">Chart start date</h3>
          <p className="mt-1 text-xs opacity-70">
            Time-series charts will only display data on/after this date.
          </p>
        </div>

        <div className="flex flex-col items-end gap-1">
          {loading ? (
            <div className="text-xs opacity-60">Loading…</div>
          ) : !configured ? (
            <div className="text-xs opacity-60">DB not migrated yet</div>
          ) : error ? (
            <div className="text-xs text-red-600 dark:text-red-400">{error}</div>
          ) : saved ? (
            <div className="text-xs text-green-600 dark:text-green-400">Saved</div>
          ) : null}
          <div className="text-[10px] opacity-60">Default: {DEFAULT_CHART_START_DATE_ISO}</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={dateText}
          onChange={(e) => {
            setError(null);
            setSaved(false);
            setDateText(e.target.value);
          }}
          className="sb-ring h-9 w-48 rounded-lg bg-white/60 px-3 text-sm dark:bg-white/10"
          disabled={loading || saving || !configured}
          aria-label="Chart start date"
        />

        <button
          type="button"
          onClick={() => void save(parsed.ok ? parsed.value : dateText)}
          disabled={loading || saving || !configured || !parsed.ok}
          className={[
            "sb-ring inline-flex h-9 items-center justify-center rounded-lg px-3 text-xs font-medium transition",
            "bg-black text-white hover:bg-black/90 dark:bg-white dark:text-black dark:hover:bg-white/90",
            (loading || saving || !configured || !parsed.ok) ? "opacity-40 cursor-not-allowed" : "",
          ].join(" ")}
          title="Save"
        >
          {saving ? "Saving…" : "Save"}
        </button>

        <button
          type="button"
          onClick={() => {
            setDateText(DEFAULT_CHART_START_DATE_ISO);
            void save(DEFAULT_CHART_START_DATE_ISO);
          }}
          disabled={loading || saving || !configured}
          className={[
            "sb-ring inline-flex h-9 items-center justify-center rounded-lg px-3 text-xs font-medium transition",
            "bg-white/60 hover:bg-white/80 dark:bg-white/10 dark:hover:bg-white/20",
            (loading || saving || !configured) ? "opacity-40 cursor-not-allowed" : "",
          ].join(" ")}
          title="Reset to default"
        >
          Reset
        </button>
      </div>
    </div>
  );
}

