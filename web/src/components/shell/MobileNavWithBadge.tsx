import { supabaseServer } from "@/lib/supabase/server";
import { MobileNav } from "./MobileNav";

export async function MobileNavWithBadge() {
  // Fetch warning counts for the latest run date (best-effort).
  // Keep this cheap: use count queries (no pagination / row fetch).
  let badgeCount = 0;
  let hasCritical = false;

  try {
    const sb = await supabaseServer();
    
    // Get the latest run date first
    const { data: latestRun } = await sb
      .from("ingestion_runs")
      .select("run_date")
      .order("run_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!latestRun?.run_date) {
      return <MobileNav healthBadgeCount={0} healthHasCritical={false} />;
    }

    const runDate = latestRun.run_date;

    const [{ count: totalWarnings }, { count: criticalWarnings }] = await Promise.all([
      sb
        .from("ingestion_warnings")
        .select("id", { count: "exact", head: true })
        .eq("run_date", runDate),
      sb
        .from("ingestion_warnings")
        .select("id", { count: "exact", head: true })
        .eq("run_date", runDate)
        .eq("severity", "critical"),
    ]);

    badgeCount = totalWarnings ?? 0;
    hasCritical = (criticalWarnings ?? 0) > 0;
  } catch (error) {
    // Silently fail - don't break navigation if badge fetch fails
    console.error("[Health Badge] Failed to fetch health badge counts:", error);
  }

  return <MobileNav healthBadgeCount={badgeCount} healthHasCritical={hasCritical} />;
}
