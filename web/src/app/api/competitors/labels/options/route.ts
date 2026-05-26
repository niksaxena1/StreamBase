import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { loadCompetitorLabelOptions } from "@/lib/competitorLabelOptions";
import { apiJsonErr, apiJsonOk, requireAdmin } from "@/lib/api/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sb = await supabaseServer();
  const auth = await requireAdmin(sb);
  if (!auth.ok) return auth.response;

  try {
    const labels = await loadCompetitorLabelOptions(supabaseService());
    return apiJsonOk({ labels });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return apiJsonErr(msg, 500);
  }
}
