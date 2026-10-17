"use server";

import { revalidateTag, updateTag } from "next/cache";

import { cleanBulkIds, runBulkUpdate, validateBulkChanges, type BulkChanges } from "@/lib/library/bulk";
import { buildNewReleaseFields, validateChanges, validateNewRelease } from "@/lib/library/edits";
import { LIBRARY_CACHE_TAG, LIBRARY_STREAMS_CACHE_TAG } from "@/lib/library/cache";
import { loadLibraryStreamSeries } from "@/lib/library/loadLibraryStreams";
import { loadLibraryOverviewRow, loadLibraryTrackDetail } from "@/lib/library/loadLibraryTrack";
import { isStreamRange } from "@/lib/library/streams";
import { loadLibraryLicensing } from "@/lib/library/loadLicensing";
import type { LibraryLicenseDetail } from "@/lib/library/licensing";
import type { LibraryRow, LibraryStreamPoint, LibraryTrackDetail } from "@/lib/library/types";
import { logError } from "@/lib/logger";
import { requireLibraryAdmin } from "@/lib/library/adminGate.server";
import { catalogService } from "@/lib/supabase/catalogService";
import { queryErrorMessage } from "@/lib/supabase/rpcErrors";

export type LibraryActionError = { ok: false; error: string };

export type LibraryDetailResult = { ok: true; detail: LibraryTrackDetail } | LibraryActionError;
export type LibrarySaveResult =
  | { ok: true; row: LibraryRow | null; detail: LibraryTrackDetail | null }
  | LibraryActionError;
export type LibraryStreamSeriesResult = { ok: true; points: LibraryStreamPoint[] } | LibraryActionError;
export type LibraryBulkResult = { ok: true; updated: number; total: number } | (LibraryActionError & { updated: number });
export type LibraryCreateResult = { ok: true; catalogId: string; row: LibraryRow | null } | LibraryActionError;
export type LibraryPackStatusResult =
  | { ok: true; updated: number; total: number; row: LibraryRow | null; detail: LibraryTrackDetail | null }
  | LibraryActionError;

const CATALOG_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function expireLibraryCache() {
  updateTag(LIBRARY_CACHE_TAG);
  revalidateTag(LIBRARY_CACHE_TAG, "max");
}

/** Files, extra codes and history for one track (loaded when its panel opens). */
export async function fetchLibraryTrackDetail(catalogId: string): Promise<LibraryDetailResult> {
  const gate = await requireLibraryAdmin();
  if (!gate.ok) return gate;
  if (!CATALOG_ID_RE.test(catalogId)) return { ok: false, error: "Unknown catalog ID" };
  try {
    return { ok: true, detail: await loadLibraryTrackDetail(catalogId) };
  } catch (error) {
    logError("Library detail load failed", error);
    return { ok: false, error: queryErrorMessage(error) };
  }
}

/** Applies only the changed fields through `catalog.update_track`, then returns the fresh row. */
export async function saveLibraryTrack(catalogId: string, changes: unknown): Promise<LibrarySaveResult> {
  const gate = await requireLibraryAdmin();
  if (!gate.ok) return gate;
  if (!CATALOG_ID_RE.test(catalogId)) return { ok: false, error: "Unknown catalog ID" };

  const checked = validateChanges(changes);
  if (!checked.ok) return checked;

  try {
    const { error } = await catalogService().schema("catalog").rpc("update_track", {
      p_catalog_id: catalogId,
      p_changes: checked.changes,
      p_actor: gate.actor,
    });
    if (error) return { ok: false, error: error.message };
  } catch (error) {
    logError("Library save failed", error);
    return { ok: false, error: queryErrorMessage(error) };
  }

  expireLibraryCache();
  // Streams are keyed by ISRC, so a changed ISRC means the cached figures belong to a different track.
  if ("isrc" in checked.changes) {
    updateTag(LIBRARY_STREAMS_CACHE_TAG);
    revalidateTag(LIBRARY_STREAMS_CACHE_TAG, "max");
  }

  // The edit is saved; a failed re-read must not look like a failed save.
  try {
    const [row, detail] = await Promise.all([loadLibraryOverviewRow(catalogId), loadLibraryTrackDetail(catalogId)]);
    return { ok: true, row, detail };
  } catch (error) {
    logError("Library re-read after save failed", error);
    return { ok: true, row: null, detail: null };
  }
}

/** Creates a release through `catalog.create_track`. */
export async function createLibraryTrack(input: unknown): Promise<LibraryCreateResult> {
  const gate = await requireLibraryAdmin();
  if (!gate.ok) return gate;

  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const text = (key: string) => (typeof raw[key] === "string" ? (raw[key] as string) : "");
  const draft = {
    entity: text("entity"),
    sheet_artist: text("sheet_artist"),
    sheet_title: text("sheet_title"),
    release_date: text("release_date"),
    distributor_account: text("distributor_account"),
  };
  const errors = validateNewRelease(draft);
  const firstError = Object.values(errors)[0];
  if (firstError) return { ok: false, error: firstError };

  let catalogId: string;
  try {
    const { data, error } = await catalogService().schema("catalog").rpc("create_track", {
      p_entity: draft.entity,
      p_fields: buildNewReleaseFields(draft),
      p_actor: gate.actor,
    });
    if (error) return { ok: false, error: error.message };
    if (typeof data !== "string" || !data) return { ok: false, error: "The database didn't return a catalog ID" };
    catalogId = data;
  } catch (error) {
    logError("Library create failed", error);
    return { ok: false, error: queryErrorMessage(error) };
  }

  expireLibraryCache();

  try {
    return { ok: true, catalogId, row: await loadLibraryOverviewRow(catalogId) };
  } catch (error) {
    logError("Library re-read after create failed", error);
    return { ok: true, catalogId, row: null };
  }
}

/** Daily cumulative streams for one release (loaded when the panel's chart asks for a range). */
export async function fetchLibraryStreamSeries(catalogId: string, days: number): Promise<LibraryStreamSeriesResult> {
  const gate = await requireLibraryAdmin();
  if (!gate.ok) return gate;
  if (!CATALOG_ID_RE.test(catalogId)) return { ok: false, error: "Unknown catalog ID" };
  if (!isStreamRange(days)) return { ok: false, error: "Unsupported range" };
  try {
    return { ok: true, points: await loadLibraryStreamSeries(catalogId, days) };
  } catch (error) {
    logError("Library stream series load failed", error);
    return { ok: false, error: queryErrorMessage(error) };
  }
}

/**
 * Applies one change to many releases through `catalog.bulk_update_tracks`, in chunks of 500, one
 * change_log entry per release. If a chunk fails, the ones before it are already saved, so the
 * result says how many releases were updated.
 */
export async function bulkUpdateLibraryTracks(catalogIds: unknown, changes: unknown): Promise<LibraryBulkResult> {
  const gate = await requireLibraryAdmin();
  if (!gate.ok) return { ...gate, updated: 0 };

  const ids = cleanBulkIds(catalogIds, CATALOG_ID_RE);
  if (!ids) return { ok: false, error: "Pick between 1 and 3,000 releases", updated: 0 };
  const checked = validateBulkChanges(changes);
  if (!checked.ok) return { ...checked, updated: 0 };

  const run = await runBulkUpdate(ids, (chunk) => callBulkUpdate(chunk, checked.changes, gate.actor));
  // Some chunks may have gone through even when a later one failed.
  if (run.updated > 0 || run.error === null) expireLibraryCache();
  if (run.error !== null) {
    return {
      ok: false,
      error: run.processed > 0 ? `Updated ${run.updated} of ${ids.length}. ${run.error}` : run.error,
      updated: run.updated,
    };
  }
  return { ok: true, updated: run.updated, total: ids.length };
}

async function callBulkUpdate(chunk: string[], changes: BulkChanges, actor: string) {
  try {
    const { data, error } = await catalogService().schema("catalog").rpc("bulk_update_tracks", {
      p_catalog_ids: chunk,
      p_changes: changes,
      p_actor: actor,
    });
    if (error) return { error: error.message };
    const changed = typeof data === "number" ? data : Number(data);
    return { changed: Number.isFinite(changed) ? changed : 0 };
  } catch (error) {
    logError("Library bulk update failed", error);
    return { error: queryErrorMessage(error) };
  }
}

/** Lists only batches containing at least one selected track, after the same admin gate as edits. */
export async function fetchLibraryLicensing(catalogIds: unknown): Promise<{ ok: true; batches: LibraryLicenseDetail[] } | LibraryActionError> {
  const gate = await requireLibraryAdmin();
  if (!gate.ok) return gate;
  const ids = cleanBulkIds(catalogIds, CATALOG_ID_RE);
  if (!ids) return { ok: false, error: "Pick between 1 and 3,000 releases" };
  try {
    return { ok: true, batches: await loadLibraryLicensing(ids) };
  } catch (error) {
    logError("Library licensing load failed", error);
    return { ok: false, error: queryErrorMessage(error) };
  }
}

/** Atomic per-batch status update; the RPC restricts changes to existing memberships and logs each. */
export async function setLibraryPackTrackStatus(packId: unknown, catalogIds: unknown, status: unknown): Promise<LibraryPackStatusResult> {
  const gate = await requireLibraryAdmin();
  if (!gate.ok) return gate;
  if (typeof packId !== "number" || !Number.isSafeInteger(packId) || packId < 1) return { ok: false, error: "Unknown batch" };
  const ids = cleanBulkIds(catalogIds, CATALOG_ID_RE);
  if (!ids) return { ok: false, error: "Pick between 1 and 3,000 releases" };
  if (status !== "staged" && status !== "sent") return { ok: false, error: "Status must be staged or sent" };
  let updated: number;
  try {
    const { data, error } = await catalogService().schema("catalog").rpc("set_pack_track_status", {
      p_pack_id: packId, p_catalog_ids: ids, p_status: status, p_actor: gate.actor,
    });
    if (error) return { ok: false, error: error.message };
    updated = Number(data);
    if (!Number.isInteger(updated) || updated < 0 || updated > ids.length) return { ok: false, error: "The database returned an invalid change count" };
  } catch (error) {
    logError("Library licensing status update failed", error);
    return { ok: false, error: queryErrorMessage(error) };
  }
  expireLibraryCache();
  // A successful write stays successful even if the fresh detail cannot be read back.
  if (ids.length === 1) {
    try {
      const [row, detail] = await Promise.all([loadLibraryOverviewRow(ids[0]), loadLibraryTrackDetail(ids[0])]);
      return { ok: true, updated, total: ids.length, row, detail };
    } catch (error) {
      logError("Library licensing re-read failed", error);
    }
  }
  return { ok: true, updated, total: ids.length, row: null, detail: null };
}

