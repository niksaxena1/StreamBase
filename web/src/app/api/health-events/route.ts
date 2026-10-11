import { NextRequest } from "next/server";
import { apiJsonErr, apiJsonOk } from "@/lib/api/server";
import { ALL_COMPETITORS_KEY } from "@/lib/competitorContext";
import { getRequestAppContext } from "@/lib/requestAppContext.server";
import { eventWindow } from "@/lib/health/events";
import { loadOwnHealthEvents } from "@/lib/health/loadOwnHealthEvents";
import { loadCompetitorHealthEvents } from "@/lib/health/competitor/loadCompetitorHealthEvents";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { svc, user, isAdmin, shellContext } = await getRequestAppContext();
  if (!user) return apiJsonErr("Unauthorized", 401);
  if (!isAdmin) return apiJsonErr("Forbidden", 403);
  const params = request.nextUrl.searchParams;
  const days = Number(params.get("days") ?? 30);
  if (days !== 7 && days !== 30 && days !== 90) return apiJsonErr("Invalid event window", 400);
  if (params.get("mode") !== shellContext.datasetMode) return apiJsonErr("Dataset changed; refresh Health", 409);
  const window = eventWindow(days);
  let result;
  if (shellContext.datasetMode === "competitor") {
    const label = params.get("label") || shellContext.competitorLabelKey;
    if (!label || (label !== ALL_COMPETITORS_KEY && !shellContext.competitorLabels.some((l) => l.label_key === label))) {
      return apiJsonErr("Invalid competitor label", 400);
    }
    result = await loadCompetitorHealthEvents(svc, window, label);
  } else {
    result = await loadOwnHealthEvents(svc, window);
  }
  if (result.error) return apiJsonErr(result.error.message, 500);
  return apiJsonOk({ events: result.data ?? [], start: window.start, end: window.end });
}
