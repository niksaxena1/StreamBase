import { supabaseServer } from "@/lib/supabase/server";
import { SideRail } from "./SideRail";

export async function SideRailWithBadge() {
  // Fetch warning counts for the latest run date
  // Wrap in try-catch to prevent errors from breaking the navigation
  let badgeCount = 0;
  let hasCritical = false;

  try {
    const sb = await supabaseServer();
    
    // Get the latest run date first (outside cache to use in logging)
    const { data: latestRun } = await sb
      .from("ingestion_runs")
      .select("run_date")
      .order("run_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    console.log("[Health Badge] Latest run date:", latestRun?.run_date);

    if (!latestRun?.run_date) {
      console.log("[Health Badge] No latest run date found");
      return <SideRail healthBadgeCount={0} healthHasCritical={false} />;
    }

    const runDate = latestRun.run_date;
    console.log("[Health Badge] Querying warnings for date:", runDate);
    
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
      
      if (error) {
        console.error("[Health Badge] Query error:", error);
        break;
      }
      
      console.log("[Health Badge] Query batch - from:", from, "to:", to, "returned:", data?.length ?? 0, "items");
      
      if (!data || data.length === 0) {
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

    console.log("[Health Badge] Query result - Total:", total, "Critical:", critical, "Severities:", {
      critical: allWarnings.filter(w => w.severity === "critical").length,
      warn: allWarnings.filter(w => w.severity === "warn").length,
      info: allWarnings.filter(w => w.severity === "info").length,
    });

    badgeCount = total; // Count ALL warnings (warn, critical, info)
    hasCritical = critical > 0;
    
    console.log("[Health Badge] Final values - Count:", badgeCount, "Has Critical:", hasCritical);
  } catch (error) {
    // Silently fail - don't break navigation if badge fetch fails
    console.error("[Health Badge] Failed to fetch health badge counts:", error);
  }

  return <SideRail healthBadgeCount={badgeCount} healthHasCritical={hasCritical} />;
}
