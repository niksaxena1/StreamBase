"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchApiJson } from "@/lib/api";
import { SAVED_FEEDBACK_MS } from "@/lib/constants";

type RapidApiAutoFixPayload = {
  rapidapi_auto_fix_enabled?: boolean;
  rapidapi_auto_fix_daily_cap?: number;
  configured?: boolean;
};

const MAX_CAP = 1000;
const DEFAULT_CAP = 70;

export function RapidApiAutoFixSetting() {
  const [enabled, setEnabled] = useState(true);
  const [capText, setCapText] = useState(String(DEFAULT_CAP));
  const [savedCap, setSavedCap] = useState(DEFAULT_CAP);
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    void fetchApiJson<RapidApiAutoFixPayload>("/api/user-settings/rapidapi-auto-fix")
      .then((data) => {
        setEnabled(data.rapidapi_auto_fix_enabled !== false);
        const cap = typeof data.rapidapi_auto_fix_daily_cap === "number"
          ? data.rapidapi_auto_fix_daily_cap
          : DEFAULT_CAP;
        setCapText(String(cap));
        setSavedCap(cap);
        setConfigured(data.configured !== false);
        setLoading(false);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Failed to load setting");
        setLoading(false);
      });
  }, []);

  const capValidation = useMemo(() => {
    const s = capText.trim();
    if (!s) return { ok: false as const, error: "Required." };
    if (!/^\d+$/.test(s)) return { ok: false as const, error: "Must be a whole number." };
    const n = Number(s);
    if (n < 1) return { ok: false as const, error: "Must be at least 1." };
    if (n > MAX_CAP) return { ok: false as const, error: `Max is ${MAX_CAP}.` };
    return { ok: true as const, value: n };
  }, [capText]);

  const capDirty = capValidation.ok && capValidation.value !== savedCap;

  async function savePatch(patch: Record<string, unknown>, rollback?: () => void) {
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const data = await fetchApiJson<RapidApiAutoFixPayload>("/api/user-settings/rapidapi-auto-fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });

      setEnabled(data.rapidapi_auto_fix_enabled !== false);
      const cap = typeof data.rapidapi_auto_fix_daily_cap === "number"
        ? data.rapidapi_auto_fix_daily_cap
        : DEFAULT_CAP;
      setCapText(String(cap));
      setSavedCap(cap);
      setSaved(true);
      setTimeout(() => setSaved(false), SAVED_FEEDBACK_MS);
    } catch (e) {
      rollback?.();
      setError(e instanceof Error ? e.message : "Failed to update setting");
    } finally {
      setSaving(false);
    }
  }

  function toggle() {
    const next = !enabled;
    setEnabled(next);
    void savePatch({ rapidapi_auto_fix_enabled: next }, () => setEnabled(!next));
  }

  function saveCap() {
    if (!capValidation.ok) return;
    void savePatch({ rapidapi_auto_fix_daily_cap: capValidation.value });
  }

  const controlsDisabled = loading || saving || !configured;

  return (
    <div className="sb-ring rounded-2xl bg-white/70 p-3 dark:bg-white/5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1">
          <h3 className="text-sm font-medium">Stream lookup auto-fix</h3>
          <p className="mt-1 text-xs opacity-70">
            When enabled, the scheduled job automatically corrects stale tracks
            via Beat Analytics first, then Music Metrics as a fallback. Disable
            to suppress all automatic overrides without removing your API key.
          </p>
        </div>

        <div className="flex flex-col items-end gap-1">
          {loading ? (
            <div className="text-xs opacity-60">Loading...</div>
          ) : !configured ? (
            <div className="text-xs opacity-60">DB not migrated yet</div>
          ) : (
            <button
              type="button"
              onClick={toggle}
              disabled={controlsDisabled}
              className={[
                "sb-ring relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                enabled ? "bg-black dark:bg-white" : "bg-black/20 dark:bg-white/20",
                controlsDisabled ? "opacity-40 cursor-not-allowed" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-label={enabled ? "Disable stream lookup auto-fix" : "Enable stream lookup auto-fix"}
            >
              <span
                className={[
                  "inline-block h-4 w-4 transform rounded-full bg-white dark:bg-black transition-transform",
                  enabled ? "translate-x-6" : "translate-x-1",
                ].join(" ")}
              />
            </button>
          )}
          {error && (
            <div className="text-xs text-red-600 dark:text-red-400">{error}</div>
          )}
          {saved && (
            <div className="text-xs text-green-600 dark:text-green-400">Saved</div>
          )}
        </div>
      </div>

      {enabled && configured && !loading && (
        <div className="mt-3 border-t border-black/10 pt-3 dark:border-white/10">
          <div className="flex flex-wrap items-center gap-3 pl-3">
            <label htmlFor="rapidapi-daily-cap" className="text-xs font-medium opacity-70">
              Daily cap
            </label>
            <input
              id="rapidapi-daily-cap"
              type="number"
              min={1}
              max={MAX_CAP}
              value={capText}
              onChange={(e) => setCapText(e.target.value)}
              disabled={controlsDisabled}
              className="sb-ring h-9 w-24 rounded-lg bg-white/60 px-2 text-sm dark:bg-white/10 disabled:opacity-40"
            />
            <span className="text-xs opacity-50">max {MAX_CAP}</span>
            {capDirty && (
              <button
                type="button"
                onClick={saveCap}
                disabled={controlsDisabled}
                className="sb-ring inline-flex h-9 items-center justify-center rounded-lg bg-black px-3 text-xs font-medium text-white hover:bg-black/90 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-white/90"
              >
                Save
              </button>
            )}
            {!capValidation.ok && capText !== String(savedCap) && (
              <span className="text-xs text-red-600 dark:text-red-400">{capValidation.error}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
