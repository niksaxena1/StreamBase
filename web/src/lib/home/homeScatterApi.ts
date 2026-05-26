import type { TrackStreamsXYPoint } from "@/components/charts/TrackStreamsXYChart";
import type { HomeDashboardSearchParams } from "@/app/(main-flat)/home/homeTypes";

export type HomeScatterApiPayload = {
  points: TrackStreamsXYPoint[];
  errorMessage: string | null;
  dataDate: string | null;
};

const SCATTER_PARAM_KEYS = ["scope", "range", "daily", "xy_date", "start", "end"] as const;

export function buildHomeScatterApiUrl(sp: HomeDashboardSearchParams): string {
  const params = new URLSearchParams();
  for (const key of SCATTER_PARAM_KEYS) {
    const raw = sp[key];
    const value = typeof raw === "string" ? raw.trim() : "";
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `/api/home/scatter?${qs}` : "/api/home/scatter";
}

export function normalizeHomeScatterApiPayload(raw: unknown): HomeScatterApiPayload {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    points: Array.isArray(obj.points) ? (obj.points as TrackStreamsXYPoint[]) : [],
    errorMessage: typeof obj.errorMessage === "string" ? obj.errorMessage : null,
    dataDate: typeof obj.dataDate === "string" ? obj.dataDate : null,
  };
}
