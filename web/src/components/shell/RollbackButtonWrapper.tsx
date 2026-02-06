import { supabaseService } from "@/lib/supabase/service";
import { dataDateFromRunDate } from "@/lib/sotDates";
import { RollbackButton } from "@/components/shell/RollbackButton";

/**
 * Server component that fetches the latest data date and passes it to the client button.
 */
export async function RollbackButtonWrapper() {
  const svc = supabaseService();
  
  // Fetch the latest run date to compute the latest data date
  const { data: latestRow } = await svc
    .from("playlist_daily_stats")
    .select("date")
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const latestRunDate = (latestRow as { date: string } | null)?.date ?? null;
  const latestDataDate = latestRunDate ? dataDateFromRunDate(latestRunDate) : null;

  return <RollbackButton latestDataDate={latestDataDate} />;
}
