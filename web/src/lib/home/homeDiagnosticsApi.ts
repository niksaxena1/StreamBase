import type {
  ArtistWeekendDipRow,
  ArtificialStreamSpikeRow,
  HomeDashboardSearchParams,
  NegativeDailyStreamsRow,
  TrackWeekendDipRow,
} from "@/app/(main-flat)/home/homeTypes";

export type HomeDiagnosticsApiPayload = {
  artistWeekendDips: ArtistWeekendDipRow[];
  trackWeekendDips: TrackWeekendDipRow[];
  negativeDailyStreams: NegativeDailyStreamsRow[];
  artificialStreamSpikes: ArtificialStreamSpikeRow[];
  errorMessage: string | null;
};

const DIAGNOSTICS_PARAM_KEYS = ["scope", "range", "daily", "xy_date", "start", "end"] as const;

export function buildHomeDiagnosticsScopeKey(
  datasetMode: "own" | "competitor",
  competitorLabelKey: string | null | undefined,
): string {
  const label = typeof competitorLabelKey === "string" ? competitorLabelKey.trim() : "";
  return `${datasetMode}:${label || "none"}`;
}

export function buildHomeDiagnosticsApiUrl(sp: HomeDashboardSearchParams): string {
  const params = new URLSearchParams();
  for (const key of DIAGNOSTICS_PARAM_KEYS) {
    const raw = sp[key];
    const value = typeof raw === "string" ? raw.trim() : "";
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `/api/home/diagnostics?${qs}` : "/api/home/diagnostics";
}

export function normalizeHomeDiagnosticsApiPayload(raw: unknown): HomeDiagnosticsApiPayload {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    artistWeekendDips: Array.isArray(obj.artistWeekendDips)
      ? (obj.artistWeekendDips as ArtistWeekendDipRow[])
      : [],
    trackWeekendDips: Array.isArray(obj.trackWeekendDips)
      ? (obj.trackWeekendDips as TrackWeekendDipRow[])
      : [],
    negativeDailyStreams: Array.isArray(obj.negativeDailyStreams)
      ? (obj.negativeDailyStreams as NegativeDailyStreamsRow[])
      : [],
    artificialStreamSpikes: Array.isArray(obj.artificialStreamSpikes)
      ? (obj.artificialStreamSpikes as ArtificialStreamSpikeRow[])
      : [],
    errorMessage: typeof obj.errorMessage === "string" ? obj.errorMessage : null,
  };
}
