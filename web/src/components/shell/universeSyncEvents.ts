import { ALL_COMPETITORS_KEY } from "@/lib/competitorContext";
import type { DatasetMode } from "@/lib/datasetMode";

export const UNIVERSE_CHANNEL = "sb:universe-change";
export const UNIVERSE_STORAGE_KEY = "sb:universe-change";
export type Universe = { datasetMode: DatasetMode; competitorLabelKey?: string | null };

export function sameUniverse(a: Universe, b: Universe): boolean {
  return a.datasetMode === b.datasetMode && (a.datasetMode === "own" ||
    (a.competitorLabelKey?.trim() || ALL_COMPETITORS_KEY) === (b.competitorLabelKey?.trim() || ALL_COMPETITORS_KEY));
}

export function settingsRequireUniverseRefresh(current: Universe, settings: unknown): boolean {
  if (!settings || typeof settings !== "object") return false;
  const row = settings as Record<string, unknown>;
  if (row.configured === false || !["own", "competitor"].includes(String(row.dataset_mode))) return false;
  return !sameUniverse(current, {
    datasetMode: row.dataset_mode as DatasetMode,
    competitorLabelKey: typeof row.competitor_label_key === "string" ? row.competitor_label_key : null,
  });
}

/** Only successful universe writes should broadcast; receivers do not rebroadcast. */
export function broadcastUniverseChange() {
  if (typeof window === "undefined") return;
  try {
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(UNIVERSE_CHANNEL);
      channel.postMessage({ type: UNIVERSE_CHANNEL });
      channel.close();
      return;
    }
  } catch { /* Fall back if this browser blocks channels. */ }
  try { localStorage.setItem(UNIVERSE_STORAGE_KEY, `${Date.now()}:${Math.random()}`); } catch { /* Storage is optional. */ }
}
