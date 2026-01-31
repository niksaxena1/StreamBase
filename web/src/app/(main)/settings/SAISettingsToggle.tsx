"use client";

import { useState, useEffect } from "react";

export function SAISettingsToggle() {
  const [saiEnabled, setSaiEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Fetch current setting
  useEffect(() => {
    setLoading(true);
    void fetch("/api/user-settings/sai")
      .then((res) => res.json())
      .then((data) => {
        setSaiEnabled(data.sai_enabled ?? true);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  async function handleToggle(newValue: boolean) {
    setError(null);
    setSaved(false);
    setSaiEnabled(newValue);

    try {
      const res = await fetch("/api/user-settings/sai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sai_enabled: newValue }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to update setting");
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update setting");
      setSaiEnabled(!newValue); // Revert on error
    }
  }

  return (
    <div className="sb-ring rounded-2xl bg-white/70 p-3 dark:bg-white/5">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <h3 className="text-sm font-medium">SAI Chat Assistant</h3>
          <p className="mt-1 text-xs opacity-70">
            Enable or disable the SAI chat button in the bottom right corner
          </p>
        </div>

        <div className="flex items-center gap-3">
          {loading ? (
            <div className="text-xs opacity-60">Loading…</div>
          ) : error ? (
            <div className="text-xs text-red-600 dark:text-red-400">{error}</div>
          ) : saved ? (
            <div className="text-xs text-green-600 dark:text-green-400">Saved</div>
          ) : null}

          <button
            type="button"
            onClick={() => handleToggle(!saiEnabled)}
            disabled={loading}
            className={[
              "sb-ring relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
              saiEnabled
                ? "bg-black dark:bg-white"
                : "bg-black/20 dark:bg-white/20",
            ].join(" ")}
            aria-label={saiEnabled ? "Disable SAI" : "Enable SAI"}
            title={saiEnabled ? "Disable SAI" : "Enable SAI"}
          >
            <span
              className={[
                "inline-block h-4 w-4 transform rounded-full bg-white dark:bg-black transition-transform",
                saiEnabled ? "translate-x-6" : "translate-x-1",
              ].join(" ")}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
