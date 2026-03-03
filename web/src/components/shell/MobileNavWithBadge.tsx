import { getActiveWarningSummary } from "@/lib/health/activeWarnings";
import { MobileNav } from "./MobileNav";
import { logError } from "@/lib/logger";

export async function MobileNavWithBadge() {
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

  return <MobileNav healthBadgeCount={badgeCount} healthHasCritical={hasCritical} healthInfoOnly={infoOnly} />;
}
