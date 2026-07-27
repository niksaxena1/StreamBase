"use server";

import { revalidateTag } from "next/cache";

import { requireUser } from "@/lib/api/server";
import { supabaseServer } from "@/lib/supabase/server";
import { recomputeActiveWarningSnapshot } from "@/lib/health/activeWarnings";

/**
 * Recompute the stored health warning snapshot and bust the cached health
 * warning data so the next render fetches fresh results.
 * Call this from client components (e.g. RefreshButton) before `router.refresh()`.
 */
export async function refreshHealthData() {
  const sb = await supabaseServer();
  const auth = await requireUser(sb);
  if (!auth.ok) return;
  await recomputeActiveWarningSnapshot();
  revalidateTag("health", "max");
}
