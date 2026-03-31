"use server";

import { revalidateTag } from "next/cache";

import { requireSessionUser } from "@/lib/api/server";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Bust the cached health warning data so the next render fetches fresh results.
 * Call this from client components (e.g. RefreshButton) before `router.refresh()`.
 */
export async function refreshHealthData() {
  const sb = await supabaseServer();
  const auth = await requireSessionUser(sb);
  if (!auth.ok) return;
  revalidateTag("health", "max");
}
