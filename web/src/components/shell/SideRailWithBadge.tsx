import { getActiveWarningSummary } from "@/lib/health/activeWarnings";
import { SideRail } from "./SideRail";
import { logError } from "@/lib/logger";

export async function SideRailWithBadge({ datasetMode = "own" }: { datasetMode?: "own" | "competitor" }) {
  let badgeCount = 0;
  let hasCritical = false;
  let infoOnly = false;

  try {
    const summary = await getActiveWarningSummary();
    badgeCount = summary.totalCount;
    hasCritical = summary.hasCritical;
    infoOnly = summary.infoOnly;
  } catch (error) {
    // Silently fail - don't break navigation if badge fetch fails
    logError("[Health Badge] Failed to fetch health badge counts", error);
  }

  return <SideRail healthBadgeCount={badgeCount} healthHasCritical={hasCritical} healthInfoOnly={infoOnly} datasetMode={datasetMode} />;
}
