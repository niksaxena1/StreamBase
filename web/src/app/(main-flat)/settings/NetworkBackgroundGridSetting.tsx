"use client";

import { useState } from "react";
import { SAVED_FEEDBACK_MS } from "@/lib/constants";
import { LS_NETWORK_SHOW_GRID } from "../network/networkGraphConstants";
import { useStoredBoolState } from "@/lib/useStoredBoolState";

export function NetworkBackgroundGridSetting() {
  const [showGrid, setShowGrid] = useStoredBoolState(LS_NETWORK_SHOW_GRID, true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function persist(next: boolean) {
    setError(null);
    setSaved(false);
    try {
      window.localStorage.setItem(LS_NETWORK_SHOW_GRID, next ? "1" : "0");
      setShowGrid(next);
      setSaved(true);
      setTimeout(() => setSaved(false), SAVED_FEEDBACK_MS);
      window.dispatchEvent(new Event("sb:network-grid-updated"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    }
  }

  return (
    <div className="sb-ring rounded-2xl bg-white/70 p-3 dark:bg-white/5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1">
          <h3 className="text-sm font-medium">Network graph grid</h3>
          <p className="mt-1 text-xs opacity-70">
            Show a light background grid on the Collaboration Network page for spatial reference while panning and zooming.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {error ? (
            <div className="text-xs text-red-600 dark:text-red-400">{error}</div>
          ) : saved ? (
            <div className="text-xs text-green-600 dark:text-green-400">Saved</div>
          ) : null}

          <button
            type="button"
            onClick={() => persist(!showGrid)}
            className={[
              "sb-ring relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
              showGrid ? "bg-black dark:bg-white" : "bg-black/20 dark:bg-white/20",
            ].join(" ")}
            aria-label={showGrid ? "Hide network grid" : "Show network grid"}
            title={showGrid ? "Hide network grid" : "Show network grid"}
          >
            <span
              className={[
                "inline-block h-4 w-4 transform rounded-full bg-white dark:bg-black transition-transform",
                showGrid ? "translate-x-6" : "translate-x-1",
              ].join(" ")}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
