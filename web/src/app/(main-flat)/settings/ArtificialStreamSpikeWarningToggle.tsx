"use client";

import { useEffect, useState } from "react";
import { fetchApiJson } from "@/lib/api";
import { SAVED_FEEDBACK_MS } from "@/lib/constants";

type Payload = {
  artificial_streams_warning_enabled?: boolean;
  configured?: boolean;
};

export function ArtificialStreamSpikeWarningToggle() {
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void fetchApiJson<Payload>("/api/health-config/artificial-stream-spike-warning")
      .then((data) => {
        setEnabled(data.artificial_streams_warning_enabled ?? true);
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
      const data = await fetchApiJson<Payload>("/api/health-config/artificial-stream-spike-warning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artificial_streams_warning_enabled: next }),
      });

      setEnabled(data.artificial_streams_warning_enabled ?? next);
      setSaved(true);
      setTimeout(() => setSaved(false), SAVED_FEEDBACK_MS);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update setting");
      setEnabled(!next);
    }
  }

  return (
    <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: "var(--sb-border)" }}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1">
          <div className="text-sm font-medium">Artificial stream spike Health warnings</div>
          <p className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
            Enable or disable ingestion-time <code className="text-[10px]">artificial_stream_spike</code>{" "}
            warnings globally. Turn this off while the detector is being redesigned; it does not hide the Home
            dashboard spike exploration section.
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
            onClick={() => void handleToggle(!enabled)}
            disabled={loading || !configured}
            className={[
              "sb-ring relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
              enabled ? "bg-black dark:bg-white" : "bg-black/20 dark:bg-white/20",
            ].join(" ")}
            aria-label={enabled ? "Disable artificial spike Health warnings" : "Enable artificial spike Health warnings"}
            title={enabled ? "Disable artificial spike Health warnings" : "Enable artificial spike Health warnings"}
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
