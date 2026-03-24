"use client";

import { useEffect, useState } from "react";
import { fetchApiJson } from "@/lib/api";
import { SAVED_FEEDBACK_MS } from "@/lib/constants";

type WeekHighlightPayload = {
  chart_week_highlight_day: number;
  configured?: boolean;
};

const DAYS: Array<{ value: number; label: string }> = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

function normalizeDay(n: unknown): number {
  const v = Number(n);
  const i = Number.isFinite(v) ? Math.trunc(v) : 0;
  return i >= 0 && i <= 6 ? i : 0;
}

export function WeekHighlightDaySetting() {
  const [day, setDay] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    void fetchApiJson<WeekHighlightPayload>("/api/user-settings/week-highlight-day")
      .then((data) => {
        setDay(normalizeDay(data.chart_week_highlight_day));
        setConfigured(data.configured !== false);
        setLoading(false);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Failed to load setting");
        setLoading(false);
      });
  }, []);

  async function save(nextDay: number) {
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const data = await fetchApiJson<WeekHighlightPayload>("/api/user-settings/week-highlight-day", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chart_week_highlight_day: nextDay }),
      });

      setDay(normalizeDay(data.chart_week_highlight_day ?? nextDay));
      setSaved(true);
      setTimeout(() => setSaved(false), SAVED_FEEDBACK_MS);

      // Let charts update without a full reload (best-effort).
      window.dispatchEvent(new Event("sb:week-highlight-day-updated"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update setting");
    } finally {
      setSaving(false);
    }
  }

  const currentLabel = DAYS.find((d) => d.value === day)?.label ?? "Sunday";

  return (
    <div className="sb-ring rounded-2xl bg-white/70 p-3 dark:bg-white/5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <h3 className="text-sm font-medium">Week highlight day</h3>
          <p className="mt-1 text-xs opacity-70">
            Choose which day of the week gets the subtle highlight in daily time-series charts.
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
          <div className="text-[10px] opacity-60">Current: {currentLabel}</div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <select
          value={String(day)}
          onChange={(e) => {
            const next = normalizeDay(e.target.value);
            setDay(next);
            if (!loading && !saving && configured) void save(next);
          }}
          disabled={loading || saving || !configured}
          className="sb-ring h-9 w-48 rounded-lg bg-white/60 px-3 text-sm dark:bg-white/10"
          aria-label="Week highlight day"
        >
          {DAYS.map((d) => (
            <option key={d.value} value={String(d.value)}>
              {d.label}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => void save(day)}
          disabled={loading || saving || !configured}
          className={[
            "sb-ring inline-flex h-9 items-center justify-center rounded-lg px-3 text-xs font-medium transition",
            "bg-black text-white hover:bg-black/90 dark:bg-white dark:text-black dark:hover:bg-white/90",
            (loading || saving || !configured) ? "opacity-40 cursor-not-allowed" : "",
          ].join(" ")}
          title="Save"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

