import { apiJsonErr, apiJsonOk } from "@/lib/api/server";
import { BEATPORT_TECH_HOUSE_KEY } from "@/lib/charts/chartsModel";
import { loadTrackChartHistory, requireChartsApiAccess } from "@/lib/charts/loadChartsPage";

export const dynamic = "force-dynamic";

/** GET /api/charts/history?source=beatport&id=123&days=90 — daily positions for one charted track. */
export async function GET(request: Request) {
  const auth = await requireChartsApiAccess();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const source = url.searchParams.get("source") ?? "";
  const id = Number(url.searchParams.get("id"));
  const days = Math.min(365, Math.max(1, Number(url.searchParams.get("days") ?? "90") || 90));
  if (!/^[a-z0-9_]{1,32}$/.test(source) || !Number.isSafeInteger(id) || id <= 0) {
    return apiJsonErr("invalid source or id", 400);
  }

  try {
    const points = await loadTrackChartHistory({
      chartKey: BEATPORT_TECH_HOUSE_KEY,
      source,
      sourceTrackId: id,
      days,
    });
    return apiJsonOk(points);
  } catch (e) {
    return apiJsonErr(e instanceof Error ? e.message : "history failed", 500);
  }
}
