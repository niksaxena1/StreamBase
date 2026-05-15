"use client";

import { useEffect, useState } from "react";
import { fetchApiJson } from "@/lib/api";
import { SAVED_FEEDBACK_MS } from "@/lib/constants";

type RapidApiAutoFixPayload = {
  rapidapi_auto_fix_enabled?: boolean;
  configured?: boolean;
};

export function RapidApiAutoFixSetting() {
  const [enabled, setEnabled] = useState(true);
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
        setConfigured(data.configured !== false);
        setLoading(false);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Failed to load setting");
        setLoading(false);
      });
  }, []);

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

  const controlsDisabled = loading || saving || !configured;

  return (
    <div className="sb-ring rounded-2xl bg-white/70 p-3 dark:bg-white/5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1">
          <h3 className="text-sm font-medium">Stream lookup auto-fix</h3>
          <p className="mt-1 text-xs opacity-70">
            When enabled, the scheduled job automatically corrects stale tracks
            via Beat Analytics first, then Music Metrics, then MusicAnalytics,
            then CheckLeakedCC. It fixes every stale track when fewer than 500
            are stale, using free provider quotas only; paid overage stays manual.
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
    </div>
  );
}
