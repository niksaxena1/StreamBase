"use server";

import { revalidateTag } from "next/cache";

/**
 * Bust the cached health warning data so the next render fetches fresh results.
 * Call this from client components (e.g. RefreshButton) before `router.refresh()`.
 */
export async function refreshHealthData() {
  revalidateTag("health", "max");
}
