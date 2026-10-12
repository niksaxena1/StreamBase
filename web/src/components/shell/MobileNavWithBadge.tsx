import { getNavigationDefaults } from "./navigationDefaults.server";
import { getActiveWarningSummary } from "@/lib/health/activeWarnings";
import { MobileNav } from "./MobileNav";
import { logError } from "@/lib/logger";
import type { AppAccess } from "@/lib/appAccess";

export async function MobileNavWithBadge({ datasetMode = "own", appAccess, isAdmin = false }: { datasetMode?: "own" | "competitor"; appAccess?: AppAccess; isAdmin?: boolean }) {
  const navigationDefaults = await getNavigationDefaults(datasetMode);
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

  return <MobileNav healthBadgeCount={badgeCount} healthHasCritical={hasCritical} healthInfoOnly={infoOnly} datasetMode={datasetMode} navigationDefaults={navigationDefaults} appAccess={appAccess} isAdmin={isAdmin} />;
}
