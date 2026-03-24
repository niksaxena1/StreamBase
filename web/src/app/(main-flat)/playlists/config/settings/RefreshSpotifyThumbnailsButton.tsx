"use client";

import { useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { fetchApiJson } from "@/lib/api";

type ThumbnailRefreshBatch = {
  processed: number;
  cursor: string | null;
  done: boolean;
  failures: Array<{ playlist_key: string; error: string }>;
};

export function RefreshSpotifyThumbnailsButton() {
  const [isRunning, setIsRunning] = useState(false);
  const [processedTotal, setProcessedTotal] = useState(0);
  const [failures, setFailures] = useState(0);

  const title = useMemo(() => {
    if (!isRunning) return "Refresh Spotify thumbnails";
    return failures > 0
      ? `Refreshing… (${processedTotal} ok, ${failures} failed)`
      : `Refreshing… (${processedTotal} updated)`;
  }, [failures, isRunning, processedTotal]);

  async function run() {
    if (isRunning) return;
    setIsRunning(true);
    setProcessedTotal(0);
    setFailures(0);

    let cursor: string | null = null;
    try {
      // Small batches to avoid rate limits / long request timeouts.
      for (let i = 0; i < 50; i++) {
        const batch: ThumbnailRefreshBatch = await fetchApiJson<ThumbnailRefreshBatch>(
          "/api/admin/spotify/refresh-playlist-thumbnails",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cursor, limit: 5, force: true }),
          },
        );

        setProcessedTotal((n) => n + (batch.processed ?? 0));
        if (batch.failures?.length) setFailures((n) => n + batch.failures.length);

        cursor = batch.cursor ?? null;
        if (batch.done) break;

        // brief pause to keep things smooth
        await new Promise((r) => setTimeout(r, 200));
      }
    } catch (e) {
      console.error("Thumbnail refresh failed:", e);
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void run()}
      className={[
        "sb-ring grid h-8 w-8 place-items-center rounded-full bg-white/70 text-xs font-medium transition hover:bg-white",
        "dark:bg-white/10 dark:hover:bg-white/15",
        isRunning ? "cursor-wait opacity-80" : "cursor-pointer",
      ].join(" ")}
      aria-label={title}
      title={title}
      disabled={isRunning}
    >
      <RefreshCw
        className={[
          "h-4 w-4",
          isRunning ? "animate-spin" : "",
        ].join(" ")}
        style={{ color: "var(--sb-text)" }}
      />
    </button>
  );
}

