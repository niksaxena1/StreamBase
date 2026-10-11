import type { supabaseService } from "@/lib/supabase/service";
import type { SupabaseQueryResult } from "@/lib/supabase/cache";
import { addDaysISO } from "@/lib/sotDates";

export type HomeDiagnosticSnapshot = {
  override_version: string | null;
  payload: unknown;
  computed_at: string;
};

/** Keep the existing combined cache key, but compare the schema's raw version. */
export function diagnosticSnapshotVersion(buster: string, dataset: "own" | "competitor") {
  const separator = buster.lastIndexOf("-comp");
  if (!buster.startsWith("own") || separator < 3) return null;
  return dataset === "own" ? buster.slice(3, separator) : buster.slice(separator + 5);
}

export function usesDefaultSpikeParameters(args: {
  runDate: string | null;
  ratio: number;
  baseline: number;
  graceDays: number;
  crossingMax: number;
  includeWeekends: boolean;
  start: string | null;
  end: string | null;
}) {
  return !!args.runDate && args.ratio === 1.25 && args.baseline === 50 &&
    args.graceDays === 14 && args.crossingMax === 1500 && !args.includeWeekends &&
    args.start === addDaysISO(args.runDate, -29) && args.end === args.runDate;
}

/** Errors, stale rows and absent migrations all preserve the live RPC path. */
export async function snapshotOrLive<T>(args: {
  eligible: boolean;
  overrideVersion: string | null;
  read: () => Promise<HomeDiagnosticSnapshot | null>;
  live: () => PromiseLike<SupabaseQueryResult<T>>;
  // Unpaged RPCs are server-capped; oversized payloads must stay live.
  maxSnapshotRows?: number;
}): Promise<SupabaseQueryResult<T>> {
  if (args.eligible && args.overrideVersion != null) {
    try {
      const row = await args.read();
      if (row && row.override_version === args.overrideVersion && Array.isArray(row.payload) &&
          row.payload.every((value) => value != null && typeof value === "object" && !Array.isArray(value)) &&
          (args.maxSnapshotRows == null || row.payload.length <= args.maxSnapshotRows)) {
        return { data: row.payload as T, error: null };
      }
    } catch { /* Best effort: the live RPC remains the source of truth. */ }
  }
  return await args.live();
}

export async function readHomeDiagnosticSnapshot(args: {
  svc: ReturnType<typeof supabaseService>;
  dataset: "own" | "competitor";
  runDate: string | null;
  labelKey?: string | null;
  kind: string;
}): Promise<HomeDiagnosticSnapshot | null> {
  if (!args.runDate) return null;
  const query = args.dataset === "competitor"
    ? args.svc.schema("competitor").from("home_diag_snapshots").select("payload,override_version,computed_at")
      .eq("run_date", args.runDate).eq("kind", args.kind).eq("params_key", "default")
      .eq("label_key", args.labelKey ?? "__all").maybeSingle()
    : args.svc.from("home_diag_snapshots").select("payload,override_version,computed_at")
      .eq("run_date", args.runDate).eq("kind", args.kind).eq("params_key", "default").maybeSingle();
  const latestIngestion = args.dataset === "competitor"
    ? args.svc.schema("competitor").from("ingestion_runs").select("finished_at").eq("status", "success")
      .order("finished_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle()
    : args.svc.from("ingestion_runs").select("finished_at").eq("status", "success")
      .order("finished_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
  const [snapshot, ingestion] = await Promise.all([
    query,
    latestIngestion,
  ]);
  if (snapshot.error || ingestion.error || !snapshot.data || !ingestion.data?.finished_at) return null;
  const row = snapshot.data as HomeDiagnosticSnapshot;
  // Includes same-date reruns and historical backfills: an old full-history
  // negative-stream payload is invalid even if its override version is unchanged.
  const computed = Date.parse(row.computed_at);
  const finished = Date.parse(ingestion.data.finished_at);
  return Number.isFinite(computed) && Number.isFinite(finished) && computed >= finished ? row : null;
}
