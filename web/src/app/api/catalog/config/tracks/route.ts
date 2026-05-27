import { loadCatalogConfigTracks } from "@/lib/catalog/loadCatalogConfig";
import { apiJsonErr, apiJsonOk, requireAdmin } from "@/lib/api/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sb = await supabaseServer();
  const auth = await requireAdmin(sb);
  if (!auth.ok) return auth.response;

  try {
    const { tracks, errorMessage } = await loadCatalogConfigTracks();
    if (errorMessage) return apiJsonErr(errorMessage, 500);
    return apiJsonOk({ tracks });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return apiJsonErr(msg, 500);
  }
}
