import { getActiveWarningSummary } from "@/lib/health/activeWarnings";
import { SideRail } from "./SideRail";

export async function SideRailWithBadge() {
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
    console.error("[Health Badge] Failed to fetch health badge counts:", error);
  }

  return <SideRail healthBadgeCount={badgeCount} healthHasCritical={hasCritical} healthInfoOnly={infoOnly} />;
}
