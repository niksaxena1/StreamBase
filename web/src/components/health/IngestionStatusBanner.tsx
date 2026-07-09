import { IngestionStatusBannerClient } from "@/components/health/IngestionStatusBannerClient";
import { loadIngestionSummaryForUser } from "@/lib/ingestionSummary.server";
import { getRequestAppContext } from "@/lib/requestAppContext.server";

export async function IngestionStatusBanner() {
  const { user, shellContext } = await getRequestAppContext();

  if (!user) return null;

  const summary = await loadIngestionSummaryForUser(user.id, shellContext.datasetMode);

  return <IngestionStatusBannerClient initialSummary={summary} pollMs={120_000} />;
}
