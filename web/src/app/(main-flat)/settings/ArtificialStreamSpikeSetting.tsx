"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchApiJson } from "@/lib/api";
import { SAVED_FEEDBACK_MS } from "@/lib/constants";

type Payload = {
  artificial_streams_spike_ratio: number;
  configured?: boolean;
};

const DEFAULT_RATIO = 1.25;
const MIN = 1.1;
const MAX = 5;
const STEP = 0.05;

function parseRatio(raw: string) {
  const s = raw.trim();
  if (!s) return { ok: false as const, error: "Required." };
  const n = Number(s);
  if (!Number.isFinite(n)) return { ok: false as const, error: "Must be a number." };
  if (n < MIN || n > MAX)
    return { ok: false as const, error: `Must be between ${MIN} and ${MAX}.` };
  return { ok: true as const, value: Math.round(n * 100) / 100 };
}

export function ArtificialStreamSpikeSetting() {
  const [text, setText] = useState(String(DEFAULT_RATIO));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const parsed = useMemo(() => parseRatio(text), [text]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    void fetchApiJson<Payload>("/api/user-settings/artificial-stream-spike")
      .then((data) => {
        const r = Number(data.artificial_streams_spike_ratio ?? DEFAULT_RATIO);
        setText(Number.isFinite(r) ? String(r) : String(DEFAULT_RATIO));
        setConfigured(data.configured !== false);
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
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setSaving(true);
    try {
      const data = await fetchApiJson<Payload>("/api/user-settings/artificial-stream-spike", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artificial_streams_spike_ratio: parsed.value }),
      });
      const r = Number(data.artificial_streams_spike_ratio ?? parsed.value);
      setText(Number.isFinite(r) ? String(r) : String(parsed.value));
      setSaved(true);
      setTimeout(() => setSaved(false), SAVED_FEEDBACK_MS);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update settings");
    } finally {
      setSaving(false);
    }
  }

  const disabled = loading || saving || !configured;

  return (
    <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: "var(--sb-border)" }}>
      <div className="text-sm font-medium">Artificial stream spike threshold</div>
      <p className="text-xs" style={{ color: "var(--sb-muted)" }}>
        Home dashboard compares each day&apos;s streams to the average of prior same weekdays. This ratio
        ({MIN}×–{MAX}×) is the multiple above baseline used to flag spikes. Ingestion uses{" "}
        <code className="text-[10px]">health_config</code>; this setting only affects your Home view.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="opacity-70">Spike ratio</span>
          <input
            type="number"
            min={MIN}
            max={MAX}
            step={STEP}
            value={text}
            disabled={disabled}
            onChange={(e) => setText(e.target.value)}
            className="sb-ring rounded px-2 py-1 text-sm w-28 bg-white/70 dark:bg-white/10"
          />
        </label>
        <button
          type="button"
          onClick={() => void save()}
          disabled={disabled || !parsed.ok}
          className="rounded px-3 py-1.5 text-xs font-medium bg-black text-white dark:bg-white dark:text-black disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      {error ? <div className="text-xs text-red-600 dark:text-red-400">{error}</div> : null}
      {saved ? <div className="text-xs text-green-600 dark:text-green-400">Saved.</div> : null}
      {!configured && !loading ? (
        <div className="text-xs opacity-70">Database column missing; apply migrations to enable.</div>
      ) : null}
    </div>
  );
}
