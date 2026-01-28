import { supabaseServer } from "@/lib/supabase/server";
import { MobileNav } from "./MobileNav";

export async function MobileNavWithBadge() {
  // Fetch warning counts for the latest run date
  // Wrap in try-catch to prevent errors from breaking the navigation
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
    
    // Query warnings directly (can't use cache with cookies/supabaseServer)
    // Get all warnings for the latest date (paginated to handle large counts)
    const pageSize = 1000;
    const allWarnings: Array<{ severity: string }> = [];
    let from = 0;
    let hasMore = true;
    
    while (hasMore) {
      const to = from + pageSize - 1;
      const { data, error } = await sb
        .from("ingestion_warnings")
        .select("severity")
        .eq("run_date", runDate)
        .range(from, to);
      
      if (error || !data || data.length === 0) {
        hasMore = false;
        break;
      }
      
      allWarnings.push(...data);
      if (data.length < pageSize) {
        hasMore = false;
      } else {
        from += pageSize;
      }
    }

    const total = allWarnings.length;
    const critical = allWarnings.filter((w) => w.severity === "critical").length;

    badgeCount = total;
    hasCritical = critical > 0;
  } catch (error) {
    // Silently fail - don't break navigation if badge fetch fails
    console.error("[Health Badge] Failed to fetch health badge counts:", error);
  }

  return <MobileNav healthBadgeCount={badgeCount} healthHasCritical={hasCritical} />;
}
