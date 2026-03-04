"use client";

import { useEffect, useState } from "react";
import { SAVED_FEEDBACK_MS } from "@/lib/constants";

function Toggle({
  checked,
  onChange,
  disabled,
  ariaLabel,
}: {
  checked: boolean;
  onChange: () => void;
  disabled: boolean;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled}
      className={[
        "sb-ring relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
        checked ? "bg-black dark:bg-white" : "bg-black/20 dark:bg-white/20",
        disabled ? "opacity-40 cursor-not-allowed" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={ariaLabel}
    >
      <span
        className={[
          "inline-block h-4 w-4 transform rounded-full bg-white dark:bg-black transition-transform",
          checked ? "translate-x-6" : "translate-x-1",
        ].join(" ")}
      />
    </button>
  );
}

export function HideStaleAnnotationsSetting() {
  const [hidden, setHidden] = useState(false);
  const [excludeCatalog, setExcludeCatalog] = useState(false);
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    void fetch("/api/user-settings/hide-stale-annotations")
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok)
          throw new Error(
            (data as Record<string, unknown>)?.error as string ??
              "Failed to load setting",
          );
        return data as Record<string, unknown>;
      })
      .then((data) => {
        setHidden(Boolean(data.hide_stale_override_annotations));
        setExcludeCatalog(Boolean(data.hide_stale_annotations_exclude_catalog));
        setConfigured(data.configured !== false);
        setLoading(false);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Failed to load setting");
        setLoading(false);
      });
  }, []);

  async function save(patch: Record<string, boolean>) {
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const res = await fetch("/api/user-settings/hide-stale-annotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok)
        throw new Error((data.error as string) ?? "Failed to update setting");

      setHidden(Boolean(data.hide_stale_override_annotations));
      setExcludeCatalog(Boolean(data.hide_stale_annotations_exclude_catalog));
      setSaved(true);
      setTimeout(() => setSaved(false), SAVED_FEEDBACK_MS);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update setting");
    } finally {
      setSaving(false);
    }
  }

  function toggleHidden() {
    const next = !hidden;
    setHidden(next);
    void save({ hide_stale_override_annotations: next });
  }

  function toggleExcludeCatalog() {
    const next = !excludeCatalog;
    setExcludeCatalog(next);
    void save({ hide_stale_annotations_exclude_catalog: next });
  }

  const controlsDisabled = loading || saving || !configured;

  return (
    <div className="sb-ring rounded-2xl bg-white/70 p-3 dark:bg-white/5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1">
          <h3 className="text-sm font-medium">
            Hide stale-fix override annotations
          </h3>
          <p className="mt-1 text-xs opacity-70">
            When enabled, chart annotations for stale-track overrides (RapidAPI
            auto/manual fixes) are hidden. Overrides for zeroed-stream tracks
            are not affected.
          </p>
        </div>

        <div className="flex flex-col items-end gap-1">
          {loading ? (
            <div className="text-xs opacity-60">Loading...</div>
          ) : !configured ? (
            <div className="text-xs opacity-60">DB not migrated yet</div>
          ) : (
            <Toggle
              checked={hidden}
              onChange={toggleHidden}
              disabled={controlsDisabled}
              ariaLabel={hidden ? "Show stale-fix annotations" : "Hide stale-fix annotations"}
            />
          )}
          {error && (
            <div className="text-xs text-red-600 dark:text-red-400">
              {error}
            </div>
          )}
          {saved && (
            <div className="text-xs text-green-600 dark:text-green-400">
              Saved
            </div>
          )}
        </div>
      </div>

      {hidden && configured && !loading && (
        <div className="mt-3 border-t border-black/10 pt-3 dark:border-white/10">
          <div className="flex items-center justify-between gap-4 pl-3">
            <div className="flex-1">
              <h4 className="text-xs font-medium">Apply to catalog page</h4>
              <p className="mt-0.5 text-xs opacity-60">
                When enabled, stale-fix annotations are also hidden on the /catalog page.
              </p>
            </div>
            <Toggle
              checked={!excludeCatalog}
              onChange={toggleExcludeCatalog}
              disabled={controlsDisabled}
              ariaLabel={excludeCatalog ? "Include catalog in hiding" : "Exclude catalog from hiding"}
            />
          </div>
        </div>
      )}
    </div>
  );
}
