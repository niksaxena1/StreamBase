"use client";

import { useEffect, useState } from "react";

import { fetchApiJson } from "@/lib/api";
import { SAVED_FEEDBACK_MS } from "@/lib/constants";

type CollectorEntityPlaylistPayload = {
  collector_entity_playlist_stats_enabled: boolean;
  configured?: boolean;
};

export function CollectorEntityPlaylistStatsSetting() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    void fetchApiJson<CollectorEntityPlaylistPayload>("/api/user-settings/collector-entity-playlists")
      .then((data) => {
        setEnabled(data.collector_entity_playlist_stats_enabled ?? false);
        setConfigured(data.configured !== false);
        setLoading(false);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Failed to load setting");
        setLoading(false);
      });
  }, []);

  async function save(nextEnabled: boolean) {
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const data = await fetchApiJson<CollectorEntityPlaylistPayload>("/api/user-settings/collector-entity-playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collector_entity_playlist_stats_enabled: nextEnabled,
        }),
      });

      setEnabled(Boolean(data.collector_entity_playlist_stats_enabled ?? nextEnabled));
      setSaved(true);
      setTimeout(() => setSaved(false), SAVED_FEEDBACK_MS);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update setting");
    } finally {
      setSaving(false);
    }
  }

  function toggle() {
    const nextEnabled = !enabled;
    setEnabled(nextEnabled);
    if (!loading && !saving && configured) void save(nextEnabled);
  }

  return (
    <div className="sb-ring rounded-2xl bg-white/70 p-3 dark:bg-white/5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <h3 className="text-sm font-medium">TG/PL entity playlist stats</h3>
          <p className="mt-1 text-xs opacity-70">
            When enabled, collector stats use TG Total for TG and P Total for PL instead of their assigned playlists.
          </p>
        </div>

        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={toggle}
            disabled={loading || saving || !configured}
            className={[
              "sb-ring relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
              enabled ? "bg-black dark:bg-white" : "bg-black/20 dark:bg-white/20",
              (loading || saving || !configured) ? "opacity-40 cursor-not-allowed" : "",
            ].join(" ")}
            aria-label={enabled ? "Disable TG and PL entity playlist stats" : "Enable TG and PL entity playlist stats"}
          >
            <span
              className={[
                "inline-block h-4 w-4 transform rounded-full bg-white transition-transform dark:bg-black",
                enabled ? "translate-x-6" : "translate-x-1",
              ].join(" ")}
            />
          </button>

          {loading ? (
            <div className="text-xs opacity-60">Loading...</div>
          ) : !configured ? (
            <div className="text-xs opacity-60">DB not migrated yet</div>
          ) : error ? (
            <div className="text-xs text-red-600 dark:text-red-400">{error}</div>
          ) : saved ? (
            <div className="text-xs text-green-600 dark:text-green-400">Saved</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
