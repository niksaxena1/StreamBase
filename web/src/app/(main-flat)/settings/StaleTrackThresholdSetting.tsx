"use client";

import { useEffect, useMemo, useState } from "react";
import { DEFAULT_STALE_MIN_STREAMS, SAVED_FEEDBACK_MS } from "@/lib/constants";

function normalizeThresholdInput(raw: string) {
  const s = raw.trim();
  if (!s) return { ok: false as const, error: "Required." };
  if (!/^\d+$/.test(s))
    return { ok: false as const, error: "Must be a whole number." };
  const n = Number(s);
  if (!Number.isFinite(n))
    return { ok: false as const, error: "Must be a number." };
  if (n < 0)
    return { ok: false as const, error: "Must be non-negative." };
  return { ok: true as const, value: n };
}

export function StaleTrackThresholdSetting() {
  const [minStreamsText, setMinStreamsText] = useState(String(DEFAULT_STALE_MIN_STREAMS));
  const [minAvgDailyText, setMinAvgDailyText] = useState("10");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const parsedMinStreams = useMemo(() => normalizeThresholdInput(minStreamsText), [minStreamsText]);
  const parsedMinAvgDaily = useMemo(() => normalizeThresholdInput(minAvgDailyText), [minAvgDailyText]);
  const allValid = parsedMinStreams.ok && parsedMinAvgDaily.ok;

  useEffect(() => {
    setLoading(true);
    setError(null);
    void fetch("/api/user-settings/stale-threshold")
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok)
          throw new Error((data as any)?.error ?? "Failed to load settings");
        return data;
      })
      .then((data) => {
        const d = data as any;
        const minStreams = Number(d?.stale_track_min_streams ?? DEFAULT_STALE_MIN_STREAMS);
        const minAvgDaily = Number(d?.stale_track_min_avg_daily ?? 10);
        setMinStreamsText(
          Number.isFinite(minStreams) ? String(minStreams) : String(DEFAULT_STALE_MIN_STREAMS),
        );
        setMinAvgDailyText(Number.isFinite(minAvgDaily) ? String(minAvgDaily) : "10");
        setConfigured(d?.configured !== false);
        setLoading(false);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Failed to load settings");
        setLoading(false);
      });
  }, []);

  async function save() {
    setError(null);
    setSaved(false);

    if (!parsedMinStreams.ok) {
      setError("Min total streams: " + parsedMinStreams.error);
      return;
    }
    if (!parsedMinAvgDaily.ok) {
      setError("Min avg daily: " + parsedMinAvgDaily.error);
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/user-settings/stale-threshold", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stale_track_min_streams: parsedMinStreams.value,
          stale_track_min_avg_daily: parsedMinAvgDaily.value,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(
          (data as any)?.error ?? "Failed to update settings",
        );

      const d = data as any;
      const savedMinStreams = Number(
        d?.stale_track_min_streams ?? parsedMinStreams.value,
      );
      const savedMinAvgDaily = Number(d?.stale_track_min_avg_daily ?? parsedMinAvgDaily.value);
      setMinStreamsText(Number.isFinite(savedMinStreams) ? String(savedMinStreams) : String(parsedMinStreams.value));
      setMinAvgDailyText(Number.isFinite(savedMinAvgDaily) ? String(savedMinAvgDaily) : String(parsedMinAvgDaily.value));
      setSaved(true);
      setTimeout(() => setSaved(false), SAVED_FEEDBACK_MS);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to update settings",
      );
    } finally {
      setSaving(false);
    }
  }

  const isDisabled = loading || saving || !configured;

  return (
    <div className="sb-ring rounded-2xl bg-white/70 p-3 dark:bg-white/5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <h3 className="text-sm font-medium">
            Stale Track Detection Thresholds
          </h3>
          <p className="mt-1 text-xs opacity-70">
            A track is flagged as stale when its stream count doesn&apos;t
            change day-over-day, but only if it meets <em>both</em>{" "}
            thresholds below. This avoids false positives on low-streaming
            tracks that naturally have zero-growth days.
          </p>
        </div>

        <div className="flex flex-col items-end gap-1">
          {loading ? (
            <div className="text-xs opacity-60">Loading…</div>
          ) : !configured ? (
            <div className="text-xs opacity-60">DB not migrated yet</div>
          ) : error ? (
            <div className="text-xs text-red-600 dark:text-red-400">
              {error}
            </div>
          ) : saved ? (
            <div className="text-xs text-green-600 dark:text-green-400">
              Saved
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <label className="w-44 text-xs opacity-70 shrink-0">
            Min total streams
          </label>
          <input
            type="text"
            inputMode="numeric"
            value={minStreamsText}
            onChange={(e) => {
              setError(null);
              setSaved(false);
              setMinStreamsText(e.target.value);
            }}
            placeholder={String(DEFAULT_STALE_MIN_STREAMS)}
            className="sb-ring h-9 w-28 rounded-lg bg-white/60 px-3 text-sm dark:bg-white/10"
            disabled={isDisabled}
            aria-label="Stale track minimum total streams"
          />
          {!parsedMinStreams.ok && minStreamsText.trim() ? (
            <span className="text-xs text-red-600 dark:text-red-400">
              {parsedMinStreams.error}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <label className="w-44 text-xs opacity-70 shrink-0">
            Min avg daily streams (7d)
          </label>
          <input
            type="text"
            inputMode="numeric"
            value={minAvgDailyText}
            onChange={(e) => {
              setError(null);
              setSaved(false);
              setMinAvgDailyText(e.target.value);
            }}
            placeholder="10"
            className="sb-ring h-9 w-28 rounded-lg bg-white/60 px-3 text-sm dark:bg-white/10"
            disabled={isDisabled}
            aria-label="Stale track minimum average daily streams over 7 days"
          />
          {!parsedMinAvgDaily.ok && minAvgDailyText.trim() ? (
            <span className="text-xs text-red-600 dark:text-red-400">
              {parsedMinAvgDaily.error}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-2 mt-1">
          <button
            type="button"
            onClick={save}
            disabled={isDisabled || !allValid}
            className={[
              "sb-ring inline-flex h-9 items-center justify-center rounded-lg px-3 text-xs font-medium transition",
              "bg-black text-white hover:bg-black/90 dark:bg-white dark:text-black dark:hover:bg-white/90",
              isDisabled || !allValid
                ? "opacity-40 cursor-not-allowed"
                : "",
            ].join(" ")}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
