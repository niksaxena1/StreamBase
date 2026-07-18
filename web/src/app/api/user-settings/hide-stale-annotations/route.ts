import { NextRequest } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import type { TableInsert } from "@/lib/supabase/appDatabase";
import { isSchemaMissing } from "@/lib/supabase/schemaMissing";
import { apiJsonErr, apiJsonOk, readJsonBodyOptional, requireUser } from "@/lib/api/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_HIDE = false;
const DEFAULT_EXCLUDE_CATALOG = false;

export async function GET() {
  const sb = await supabaseServer();
  const auth = await requireUser(sb);
  if (!auth.ok) return auth.response;

  const svc = supabaseService();
  const { data: settings, error } = await svc
    .from("user_settings")
    .select("hide_stale_override_annotations, hide_stale_annotations_exclude_catalog")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      return apiJsonOk({
        hide_stale_override_annotations: DEFAULT_HIDE,
        hide_stale_annotations_exclude_catalog: DEFAULT_EXCLUDE_CATALOG,
        configured: false as const,
      });
    }
    return apiJsonErr(error.message, 500);
  }

  const row = settings as Record<string, unknown> | null;
  const val = row?.hide_stale_override_annotations;
  const excludeCatalog = row?.hide_stale_annotations_exclude_catalog;

  return apiJsonOk({
    hide_stale_override_annotations: typeof val === "boolean" ? val : DEFAULT_HIDE,
    hide_stale_annotations_exclude_catalog:
      typeof excludeCatalog === "boolean" ? excludeCatalog : DEFAULT_EXCLUDE_CATALOG,
    configured: true as const,
  });
}

function parseBool(val: unknown): boolean | null {
  if (typeof val === "boolean") return val;
  if (val === undefined || val === null) return null;
  const s = String(val).trim().toLowerCase();
  if (s === "true" || s === "1") return true;
  if (s === "false" || s === "0") return false;
  return null;
}

export async function POST(request: NextRequest) {
  const sb = await supabaseServer();
  const auth = await requireUser(sb);
  if (!auth.ok) return auth.response;

  const body = await readJsonBodyOptional(request);

  const hideRaw = body.hide_stale_override_annotations ?? body.enabled;
  const excludeCatalogRaw = body.hide_stale_annotations_exclude_catalog;

  const hideVal = parseBool(hideRaw);
  const excludeCatalogVal = parseBool(excludeCatalogRaw);

  if (hideVal === null && excludeCatalogVal === null) {
    return apiJsonErr("No recognised boolean field provided.", 400);
  }

  const patch: TableInsert<"user_settings"> = { user_id: auth.user.id };
  if (hideVal !== null) patch.hide_stale_override_annotations = hideVal;
  if (excludeCatalogVal !== null) patch.hide_stale_annotations_exclude_catalog = excludeCatalogVal;

  const svc = supabaseService();
  const { data: upserted, error } = await svc
    .from("user_settings")
    .upsert([patch], { onConflict: "user_id" })
    .select("hide_stale_override_annotations, hide_stale_annotations_exclude_catalog")
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      return apiJsonErr("Setting isn't configured in the database yet. Apply migrations, then retry.", 503);
    }
    return apiJsonErr(error.message, 500);
  }

  const row = upserted as Record<string, unknown> | null;
  const savedHide = row?.hide_stale_override_annotations;
  const savedExclude = row?.hide_stale_annotations_exclude_catalog;

  return apiJsonOk({
    hide_stale_override_annotations: typeof savedHide === "boolean" ? savedHide : (hideVal ?? DEFAULT_HIDE),
    hide_stale_annotations_exclude_catalog:
      typeof savedExclude === "boolean" ? savedExclude : (excludeCatalogVal ?? DEFAULT_EXCLUDE_CATALOG),
    configured: true as const,
  });
}
