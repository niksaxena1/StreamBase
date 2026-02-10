"use client";

import { useEffect, useMemo, useState } from "react";

function normalizeThresholdInput(raw: string) {
  const s = raw.trim();
  if (!s) return { ok: false as const, error: "Threshold is required." };
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
  const [text, setText] = useState("2000");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const parsed = useMemo(() => normalizeThresholdInput(text), [text]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    void fetch("/api/user-settings/stale-threshold")
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok)
          throw new Error((data as any)?.error ?? "Failed to load threshold");
        return data;
      })
      .then((data) => {
        const val = Number(
          (data as any)?.stale_track_min_streams ?? 2000,
        );
        setText(Number.isFinite(val) ? String(val) : "2000");
        setConfigured((data as any)?.configured !== false);
        setLoading(false);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Failed to load threshold");
        setLoading(false);
      });
  }, []);

  async function save() {
    setError(null);
    setSaved(false);

    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/user-settings/stale-threshold", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stale_track_min_streams: parsed.value }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(
          (data as any)?.error ?? "Failed to update threshold",
        );

      const savedVal = Number(
        (data as any)?.stale_track_min_streams ?? parsed.value,
      );
      setText(
        Number.isFinite(savedVal)
          ? String(savedVal)
          : String(parsed.value),
      );
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to update threshold",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="sb-ring rounded-2xl bg-white/70 p-3 dark:bg-white/5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <h3 className="text-sm font-medium">
            Stale Track Detection Threshold
          </h3>
          <p className="mt-1 text-xs opacity-70">
            Minimum cumulative streams for a track to be flagged when its
            stream count doesn&apos;t change day-over-day. Set to{" "}
            <span className="font-mono">0</span> to flag all tracks with
            zero daily growth.
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

      <div className="mt-3 flex items-center gap-2">
        <input
          type="text"
          inputMode="numeric"
          value={text}
          onChange={(e) => {
            setError(null);
            setSaved(false);
            setText(e.target.value);
          }}
          placeholder="2000"
          className="sb-ring h-9 w-40 rounded-lg bg-white/60 px-3 text-sm dark:bg-white/10"
          disabled={loading || saving || !configured}
          aria-label="Stale track minimum cumulative streams"
        />

        <button
          type="button"
          onClick={save}
          disabled={loading || saving || !configured || !parsed.ok}
          className={[
            "sb-ring inline-flex h-9 items-center justify-center rounded-lg px-3 text-xs font-medium transition",
            "bg-black text-white hover:bg-black/90 dark:bg-white dark:text-black dark:hover:bg-white/90",
            loading || saving || !configured || !parsed.ok
              ? "opacity-40 cursor-not-allowed"
              : "",
          ].join(" ")}
        >
          {saving ? "Saving…" : "Save"}
        </button>

        {!parsed.ok && text.trim() ? (
          <div className="text-xs text-red-600 dark:text-red-400">
            {parsed.error}
          </div>
        ) : null}
      </div>
    </div>
  );
}
