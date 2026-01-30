import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { SideRail } from "./SideRail";

export async function SideRailWithBadge() {
  // Fetch warning counts for the latest run date (best-effort).
  // Keep this cheap: use count queries (no pagination / row fetch).
  let badgeCount = 0;
  let hasCritical = false;

  try {
    const sb = await supabaseServer();
    let db: typeof sb;
    try {
      db = supabaseService() as unknown as typeof sb;
    } catch {
      db = sb;
    }
    
    // Get the latest run date first
    const { data: latestRun } = await db
      .from("ingestion_runs")
      .select("run_date")
      .order("run_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!latestRun?.run_date) {
      return <SideRail healthBadgeCount={0} healthHasCritical={false} />;
    }

    const runDate = latestRun.run_date;

    const [{ count: totalWarnings }, { count: criticalWarnings }] = await Promise.all([
      db
        .from("ingestion_warnings")
        .select("id", { count: "exact", head: true })
        .eq("run_date", runDate),
      db
        .from("ingestion_warnings")
        .select("id", { count: "exact", head: true })
        .eq("run_date", runDate)
        .eq("severity", "critical"),
    ]);

    badgeCount = totalWarnings ?? 0; // Count ALL warnings (warn, critical, info)
    hasCritical = (criticalWarnings ?? 0) > 0;
  } catch (error) {
    // Silently fail - don't break navigation if badge fetch fails
    console.error("[Health Badge] Failed to fetch health badge counts:", error);
  }

  return <SideRail healthBadgeCount={badgeCount} healthHasCritical={hasCritical} />;
}
