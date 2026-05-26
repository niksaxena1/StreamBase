import { supabaseServer } from "@/lib/supabase/server";
import { IngestionStatusBannerClient } from "@/components/health/IngestionStatusBannerClient";
import { loadIngestionSummaryForUser } from "@/lib/ingestionSummary.server";

export async function IngestionStatusBanner() {
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();

  if (!user) return null;

  const summary = await loadIngestionSummaryForUser(user.id);

  return <IngestionStatusBannerClient initialSummary={summary} pollMs={120_000} />;
}
