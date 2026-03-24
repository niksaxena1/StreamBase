"use client";

import { useEffect, useState } from "react";
import { fetchApiJson } from "@/lib/api";
import { SAVED_FEEDBACK_MS } from "@/lib/constants";

type ChartAxisZoomPayload = {
  chart_zoom_daily_y_axis: boolean;
  chart_zoom_daily_y_axis_collector_comparison: boolean;
  configured?: boolean;
};

export function ChartAxisZoomSetting() {
  const [zoomDaily, setZoomDaily] = useState(true);
  const [zoomCollector, setZoomCollector] = useState(true);
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    void fetchApiJson<ChartAxisZoomPayload>("/api/user-settings/chart-y-axis-zoom")
      .then((data) => {
        setZoomDaily(data.chart_zoom_daily_y_axis ?? true);
        setZoomCollector(data.chart_zoom_daily_y_axis_collector_comparison ?? true);
        setConfigured(data.configured !== false);
        setLoading(false);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Failed to load setting");
        setLoading(false);
      });
  }, []);

  async function save(nextDaily: boolean, nextCollector: boolean) {
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const data = await fetchApiJson<ChartAxisZoomPayload>("/api/user-settings/chart-y-axis-zoom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chart_zoom_daily_y_axis: nextDaily,
          chart_zoom_daily_y_axis_collector_comparison: nextCollector,
        }),
      });

      setZoomDaily(Boolean(data.chart_zoom_daily_y_axis ?? nextDaily));
      setZoomCollector(Boolean(data.chart_zoom_daily_y_axis_collector_comparison ?? nextCollector));
      setSaved(true);
      setTimeout(() => setSaved(false), SAVED_FEEDBACK_MS);

      window.dispatchEvent(new Event("sb:chart-axis-zoom-updated"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update setting");
    } finally {
      setSaving(false);
    }
  }

  function toggleDaily() {
    const nextDaily = !zoomDaily;
    setZoomDaily(nextDaily);
    if (!loading && !saving && configured) void save(nextDaily, zoomCollector);
  }

  function toggleCollector() {
    const nextCollector = !zoomCollector;
    setZoomCollector(nextCollector);
    if (!loading && !saving && configured) void save(zoomDaily, nextCollector);
  }

  return (
    <div className="sb-ring rounded-2xl bg-white/70 p-3 dark:bg-white/5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <h3 className="text-sm font-medium">Daily chart Y-axis zoom</h3>
          <p className="mt-1 text-xs opacity-70">
            When enabled, daily charts use a padded min/max Y-axis domain so day-to-day changes are easier to see.
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
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs opacity-70">Zoom daily charts</div>
          <button
            type="button"
            onClick={toggleDaily}
            disabled={loading || saving || !configured}
            className={[
              "sb-ring relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
              zoomDaily ? "bg-black dark:bg-white" : "bg-black/20 dark:bg-white/20",
              (loading || saving || !configured) ? "opacity-40 cursor-not-allowed" : "",
            ].join(" ")}
            aria-label={zoomDaily ? "Disable daily Y-axis zoom" : "Enable daily Y-axis zoom"}
          >
            <span
              className={[
                "inline-block h-4 w-4 transform rounded-full bg-white dark:bg-black transition-transform",
                zoomDaily ? "translate-x-6" : "translate-x-1",
              ].join(" ")}
            />
          </button>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="text-xs opacity-70">Apply to Collector Comparison chart</div>
          <button
            type="button"
            onClick={toggleCollector}
            disabled={loading || saving || !configured || !zoomDaily}
            className={[
              "sb-ring relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
              zoomCollector ? "bg-black dark:bg-white" : "bg-black/20 dark:bg-white/20",
              (loading || saving || !configured || !zoomDaily) ? "opacity-40 cursor-not-allowed" : "",
            ].join(" ")}
            aria-label={
              zoomCollector ? "Disable Collector Comparison Y-axis zoom" : "Enable Collector Comparison Y-axis zoom"
            }
            title={!zoomDaily ? "Enable daily chart zoom to configure this" : undefined}
          >
            <span
              className={[
                "inline-block h-4 w-4 transform rounded-full bg-white dark:bg-black transition-transform",
                zoomCollector ? "translate-x-6" : "translate-x-1",
              ].join(" ")}
            />
          </button>
        </div>
      </div>
    </div>
  );
}

