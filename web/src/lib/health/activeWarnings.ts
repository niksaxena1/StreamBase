import { unstable_cache } from "next/cache";
import { supabaseService } from "@/lib/supabase/service";
import { normalizeKey, normalizeIsrc } from "./types";
import type {
  WarningRow,
  CatalogMissingSnapshotsDetailsJson,
  IndividualTracksStaleDetailsJson,
  PrevNonzeroDetailsJson,
  TotalStreamsDecreasedDetailsJson,
} from "./types";

// Re-export for backward compatibility
export { normalizeKey } from "./types";
export type { WarningRow } from "./types";

export type ActiveWarningSummary = {
  runDate: string | null;
  warnings: WarningRow[];
  totalCount: number;
  criticalCount: number;
  warnCount: number;
  hasCritical: boolean;
  hasWarn: boolean;
  /** True when every active warning is severity "info" (no warn/critical). */
  infoOnly: boolean;
};

// ---------------------------------------------------------------------------
// Core computation (un-cached)
// ---------------------------------------------------------------------------

async function computeActiveWarnings(
  runDate?: string,
): Promise<ActiveWarningSummary> {
  let svc: ReturnType<typeof supabaseService>;
  try {
    svc = supabaseService();
  } catch {
    // Service role key missing – return empty summary.
    return {
      runDate: null,
      warnings: [],
      totalCount: 0,
      criticalCount: 0,
      warnCount: 0,
      hasCritical: false,
      hasWarn: false,
      infoOnly: false,
    };
  }

  // 1. Resolve run_date -------------------------------------------------------
  let targetRunDate = runDate ?? null;
  if (!targetRunDate) {
    const { data: latestRun } = await svc
      .from("ingestion_runs")
      .select("run_date")
      .order("run_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    targetRunDate = (latestRun?.run_date as string) ?? null;
  }

  if (!targetRunDate) {
    return {
      runDate: null,
      warnings: [],
      totalCount: 0,
      criticalCount: 0,
      warnCount: 0,
      hasCritical: false,
      hasWarn: false,
      infoOnly: false,
    };
  }

  // 2. Fetch all warnings (raised limit from 200 → 2 000) --------------------
  const { data: rawWarnings } = await svc
    .from("ingestion_warnings")
    .select("severity,code,playlist_key,message,run_date,details_json")
    .eq("run_date", targetRunDate)
    .order("playlist_key", { ascending: true })
    .limit(2000);

  const allWarnings: WarningRow[] = (rawWarnings ?? []).map((w: Record<string, unknown>) => ({
    severity: String(w.severity ?? ""),
    code: String(w.code ?? ""),
    playlist_key: w.playlist_key ? String(w.playlist_key) : null,
    message: String(w.message ?? ""),
    run_date: String(w.run_date ?? ""),
    details_json: (w.details_json ?? null) as Record<string, unknown> | null,
  }));

  // 3. Load exclusion sets (best-effort) --------------------------------------
  const excludedGlobal = new Set<string>();
  const excludedByPlaylist = new Map<string, Set<string>>();
  const excludedEnrichmentGlobal = new Set<string>();
  const excludedEnrichmentByPlaylist = new Map<string, Set<string>>();

  try {
    const [{ data: ncExcl }, { data: enrExcl }] = await Promise.all([
      svc
        .from("health_warning_exclusions")
        .select("playlist_key,isrc")
        .eq("code", "non_catalog_tracks_present")
        .limit(2000),
      svc
        .from("health_warning_exclusions")
        .select("playlist_key,isrc")
        .eq("code", "tracks_missing_enrichment")
        .limit(2000),
    ]);

    for (const r of ncExcl ?? []) {
      const row = (r ?? {}) as Record<string, unknown>;
      const isrc = normalizeIsrc(row.isrc);
      const pk = normalizeKey(row.playlist_key as string);
      if (!isrc) continue;
      if (!pk) {
        excludedGlobal.add(isrc);
      } else {
        if (!excludedByPlaylist.has(pk))
          excludedByPlaylist.set(pk, new Set());
        excludedByPlaylist.get(pk)!.add(isrc);
      }
    }

    for (const r of enrExcl ?? []) {
      const row = (r ?? {}) as Record<string, unknown>;
      const isrc = normalizeIsrc(row.isrc);
      const pk = normalizeKey(row.playlist_key as string);
      if (!isrc) continue;
      if (!pk) {
        excludedEnrichmentGlobal.add(isrc);
      } else {
        if (!excludedEnrichmentByPlaylist.has(pk))
          excludedEnrichmentByPlaylist.set(pk, new Set());
        excludedEnrichmentByPlaylist.get(pk)!.add(isrc);
      }
    }
  } catch {
    // Table may not exist yet – proceed without exclusions.
  }

  const exclusionsEnabled =
    excludedGlobal.size > 0 || excludedByPlaylist.size > 0;

  function isExcluded(playlistKey: string, isrc: string): boolean {
    if (!isrc) return false;
    if (excludedGlobal.has(isrc)) return true;
    const s = excludedByPlaylist.get(playlistKey);
    return Boolean(s && s.has(isrc));
  }

  function isExcludedEnrichment(
    playlistKey: string,
    isrc: string,
  ): boolean {
    if (!isrc) return false;
    if (excludedEnrichmentGlobal.has(isrc)) return true;
    const s = excludedEnrichmentByPlaylist.get(playlistKey);
    return Boolean(s && s.has(isrc));
  }

  // 3b. Load stream overrides for run date (to suppress resolved stale warnings).
  // track_daily_streams.date stores the run date, and overrides match that convention.
  const overriddenIsrcs = new Set<string>();
  try {
    const { data: overrideRows } = await svc
      .from("track_daily_stream_overrides")
      .select("isrc")
      .eq("date", targetRunDate)
      .limit(5000);
    for (const r of (overrideRows ?? []) as Array<Record<string, unknown>>) {
      const isrc = normalizeIsrc(r.isrc);
      if (isrc) overriddenIsrcs.add(isrc);
    }
  } catch {
    // Table may not exist yet – proceed without overrides.
  }

  // 4. Determine which warnings are still "active" ---------------------------

  // 4a. non_catalog_tracks_present – call per-playlist RPC
  const ncWarnings = allWarnings.filter(
    (w) => w.code === "non_catalog_tracks_present" && w.playlist_key,
  );
  const ncActive = new Set<string>();
  if (ncWarnings.length > 0) {
    await Promise.all(
      ncWarnings.map(async (w) => {
        if (!w.playlist_key) return;
        try {
          const { data: rows } = await svc.rpc(
            "health_playlist_missing_catalog_tracks",
            { playlist_key: w.playlist_key, run_date: targetRunDate },
          );
          const tracks = (rows ?? []) as Array<Record<string, unknown>>;
          const filtered = exclusionsEnabled
            ? tracks.filter(
                (t) =>
                  !isExcluded(w.playlist_key!, normalizeIsrc(t.isrc)),
              )
            : tracks;
          if (filtered.length > 0) ncActive.add(w.playlist_key!);
        } catch {
          ncActive.add(w.playlist_key!); // keep on error
        }
      }),
    );
  }

  // 4b. tracks_missing_enrichment – check tracks table
  const enrWarnings = allWarnings.filter(
    (w) => w.code === "tracks_missing_enrichment" && w.playlist_key,
  );
  const enrActive = new Set<string>();
  if (enrWarnings.length > 0) {
    await Promise.all(
      enrWarnings.map(async (w) => {
        if (!w.playlist_key) return;
        const isrcList = (w.details_json?.isrc_list as unknown[] | undefined) ?? [];
        if (!Array.isArray(isrcList) || isrcList.length === 0) {
          // No ISRC list – can't verify, keep warning.
          enrActive.add(w.playlist_key!);
          return;
        }
        try {
          const filtered = (isrcList as unknown[])
            .map((x) => normalizeIsrc(x))
            .filter(Boolean)
            .filter(
              (isrc) => !isExcludedEnrichment(w.playlist_key!, isrc),
            );
          if (filtered.length === 0) return; // all excluded → suppress
          const { data: rows } = await svc
            .from("tracks")
            .select("isrc")
            .in("isrc", filtered)
            .is("spotify_artist_ids", null);
          const stillMissing = (rows ?? []).filter(
            (r: any) =>
              !isExcludedEnrichment(
                w.playlist_key!,
                normalizeIsrc(r.isrc),
              ),
          );
          if (stillMissing.length > 0) enrActive.add(w.playlist_key!);
        } catch {
          enrActive.add(w.playlist_key!);
        }
      }),
    );
  }

  // 4c. entity_distro_drift – single RPC returns all drift rows
  const driftWarnings = allWarnings.filter(
    (w) => w.code === "entity_distro_drift" && w.playlist_key,
  );
  const driftActiveKeys = new Set<string>();
  let driftLoaded = false;
  if (driftWarnings.length > 0) {
    try {
      const { data: driftRows, error: driftErr } = await svc.rpc(
        "health_entity_distro_drift",
        { run_date: targetRunDate },
      );
      if (!driftErr) {
        driftLoaded = true;
        for (const row of (driftRows ?? []) as Array<
          Record<string, unknown>
        >) {
          const key = normalizeKey(row.entity_playlist_key as string);
          if (key) driftActiveKeys.add(key);
        }
      }
    } catch {
      // RPC failed – keep all drift warnings.
    }
  }

  // 4d. distro_overlap – call RPC to check if overlaps still exist
  const overlapWarnings = allWarnings.filter(
    (w) => w.code === "distro_overlap",
  );
  let overlapActive = true;
  let overlapLoaded = false;
  if (overlapWarnings.length > 0) {
    try {
      const { data: overlapRows, error: overlapErr } = await svc.rpc(
        "health_distro_overlap_tracks",
        { run_date: targetRunDate },
      );
      if (!overlapErr) {
        overlapLoaded = true;
        overlapActive = (overlapRows ?? []).length > 0;
      }
    } catch {
      // RPC may not exist yet – keep warning.
    }
  }

  // 4e. negative_daily_streams – call RPC for tracks with negative daily deltas
  let negativeStreamsRows: Array<Record<string, unknown>> = [];
  try {
    const { data: rows, error: negErr } = await svc.rpc(
      "health_negative_daily_streams",
      { run_date: targetRunDate },
    );
    if (!negErr && Array.isArray(rows)) {
      negativeStreamsRows = rows;
    }
  } catch {
    // RPC may not exist yet – proceed without it.
  }

  // 5. Build filtered list + inject synthetic negative_daily_streams warning ----
  const active = allWarnings.filter((w) => {
    if (w.code === "non_catalog_tracks_present" && w.playlist_key) {
      return exclusionsEnabled ? ncActive.has(w.playlist_key) : true;
    }
    if (w.code === "tracks_missing_enrichment" && w.playlist_key) {
      return enrActive.has(w.playlist_key);
    }
    if (w.code === "entity_distro_drift" && w.playlist_key) {
      return driftLoaded
        ? driftActiveKeys.has(normalizeKey(w.playlist_key))
        : true;
    }
    if (w.code === "distro_overlap") {
      return overlapLoaded ? overlapActive : true;
    }
    if (w.code === "individual_tracks_stale" && overriddenIsrcs.size > 0) {
      const details = w.details_json as IndividualTracksStaleDetailsJson | null;
      const affected = details?.affected_tracks;
      if (Array.isArray(affected) && affected.length > 0) {
        const remaining = affected.filter(
          (t) => !overriddenIsrcs.has(normalizeIsrc(t.isrc)),
        );
        return remaining.length > 0;
      }
    }
    if (w.code === "catalog_missing_stream_snapshots" && overriddenIsrcs.size > 0) {
      const details = w.details_json as CatalogMissingSnapshotsDetailsJson | null;
      const affected = details?.missing_isrcs_sample;
      if (Array.isArray(affected) && affected.length > 0) {
        const remaining = affected.filter(
          (isrc) => !overriddenIsrcs.has(normalizeIsrc(isrc)),
        );
        return remaining.length > 0;
      }
    }
    if (w.code === "catalog_streams_missing_prev_nonzero" && overriddenIsrcs.size > 0) {
      const details = w.details_json as PrevNonzeroDetailsJson | null;
      const affected = details?.affected_isrcs_with_prev_sample;
      if (Array.isArray(affected) && affected.length > 0) {
        const remaining = affected.filter(
          (t) => !overriddenIsrcs.has(normalizeIsrc(t.isrc)),
        );
        return remaining.length > 0;
      }
    }
    if (w.code === "total_streams_decreased" && overriddenIsrcs.size > 0) {
      const details = w.details_json as TotalStreamsDecreasedDetailsJson | null;
      const decreased = details?.decreased_tracks ?? [];
      const removed = details?.removed_tracks ?? [];
      const affected = [...decreased, ...removed]
        .map((t) => normalizeIsrc(t.isrc))
        .filter(Boolean);
      if (affected.length > 0) {
        const remaining = affected.filter((isrc) => !overriddenIsrcs.has(isrc));
        return remaining.length > 0;
      }
    }
    return true;
  });

  // Inject synthetic negative_daily_streams warning if tracks exist
  if (negativeStreamsRows.length > 0) {
    const isrcList = negativeStreamsRows
      .map((r) => String(r.isrc ?? "").trim())
      .filter(Boolean);
    active.push({
      severity: "warn",
      code: "negative_daily_streams",
      playlist_key: null,
      message: `${negativeStreamsRows.length} track(s) had negative daily streams`,
      run_date: targetRunDate,
      details_json: { isrc_list: isrcList },
    });
  }

  const criticalCount = active.filter(
    (w) => w.severity === "critical",
  ).length;
  const warnCount = active.filter(
    (w) => w.severity === "warn",
  ).length;

  return {
    runDate: targetRunDate,
    warnings: active,
    totalCount: active.length,
    criticalCount,
    warnCount,
    hasCritical: criticalCount > 0,
    hasWarn: warnCount > 0,
    infoOnly: criticalCount === 0 && warnCount === 0 && active.length > 0,
  };
}

// ---------------------------------------------------------------------------
// Cached entry point
// ---------------------------------------------------------------------------

/**
 * Retrieve the active (non-suppressed) health warnings for a given run date.
 *
 * Results are cached for 60 seconds. Call `revalidateTag("health")` (via the
 * `refreshHealthData` server action) to bust the cache on-demand.
 *
 * @param runDate  ISO date string.  When omitted the latest run date is used.
 */
export function getActiveWarningSummary(
  runDate?: string,
): Promise<ActiveWarningSummary> {
  const cacheKey = `health-active-${runDate ?? "latest"}`;
  return unstable_cache(
    () => computeActiveWarnings(runDate),
    [cacheKey],
    { revalidate: 60, tags: ["health", cacheKey] },
  )();
}
