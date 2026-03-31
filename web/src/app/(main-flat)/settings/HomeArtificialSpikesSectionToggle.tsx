"use client";

import { useEffect, useState } from "react";
import { fetchApiJson } from "@/lib/api";
import { SAVED_FEEDBACK_MS } from "@/lib/constants";
import { invalidateUserSettingsBundle } from "@/lib/userSettingsBundleFetch";

type Payload = {
  home_artificial_spikes_section_enabled?: boolean;
  configured?: boolean;
};

export function HomeArtificialSpikesSectionToggle() {
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    void fetchApiJson<Payload>("/api/user-settings/home-artificial-spikes-section")
      .then((data) => {
        setEnabled(data.home_artificial_spikes_section_enabled ?? true);
        setConfigured(data.configured !== false);
        setLoading(false);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Failed to load setting");
        setLoading(false);
      });
  }, []);

  async function handleToggle(next: boolean) {
    setError(null);
    setSaved(false);
    setEnabled(next);

    try {
      await fetchApiJson<Payload>("/api/user-settings/home-artificial-spikes-section", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ home_artificial_spikes_section_enabled: next }),
      });

      setSaved(true);
      setTimeout(() => setSaved(false), SAVED_FEEDBACK_MS);

      invalidateUserSettingsBundle();
      window.dispatchEvent(new Event("sb:home-artificial-spikes-section-setting-updated"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update setting");
      setEnabled(!next);
    }
  }

  return (
    <div className="sb-ring rounded-2xl bg-white/70 p-3 dark:bg-white/5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1">
          <h3 className="text-sm font-medium">Same-weekday spikes on Home</h3>
          <p className="mt-1 text-xs opacity-70">
            Show or hide the TRACKS: SAME-WEEKDAY SPIKES section on the Home page.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {loading ? (
            <div className="text-xs opacity-60">Loading…</div>
          ) : !configured ? (
            <div className="text-xs opacity-60">DB not migrated yet</div>
          ) : error ? (
            <div className="text-xs text-red-600 dark:text-red-400">{error}</div>
          ) : saved ? (
            <div className="text-xs text-green-600 dark:text-green-400">Saved</div>
          ) : null}

          <button
            type="button"
            onClick={() => handleToggle(!enabled)}
            disabled={loading || !configured}
            className={[
              "sb-ring relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
              enabled ? "bg-black dark:bg-white" : "bg-black/20 dark:bg-white/20",
            ].join(" ")}
            aria-label={enabled ? "Hide spikes section on Home" : "Show spikes section on Home"}
            title={enabled ? "Hide spikes section on Home" : "Show spikes section on Home"}
          >
            <span
              className={[
                "inline-block h-4 w-4 transform rounded-full bg-white dark:bg-black transition-transform",
                enabled ? "translate-x-6" : "translate-x-1",
              ].join(" ")}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
