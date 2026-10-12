"use server";

import { revalidateTag, updateTag } from "next/cache";

import { buildNewReleaseFields, validateChanges, validateNewRelease } from "@/lib/library/edits";
import { LIBRARY_CACHE_TAG } from "@/lib/library/cache";
import { loadLibraryOverviewRow, loadLibraryTrackDetail } from "@/lib/library/loadLibraryTrack";
import type { LibraryRow, LibraryTrackDetail } from "@/lib/library/types";
import { logError } from "@/lib/logger";
import { requireLibraryAdmin } from "@/lib/library/adminGate.server";
import { catalogService } from "@/lib/supabase/catalogService";
import { queryErrorMessage } from "@/lib/supabase/rpcErrors";

export type LibraryActionError = { ok: false; error: string };

export type LibraryDetailResult = { ok: true; detail: LibraryTrackDetail } | LibraryActionError;
export type LibrarySaveResult =
  | { ok: true; row: LibraryRow | null; detail: LibraryTrackDetail | null }
  | LibraryActionError;
export type LibraryCreateResult = { ok: true; catalogId: string; row: LibraryRow | null } | LibraryActionError;

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
