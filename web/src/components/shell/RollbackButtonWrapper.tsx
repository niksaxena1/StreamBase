import { normalizeDatasetMode } from "@/lib/datasetMode";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { dataDateFromRunDate } from "@/lib/sotDates";
import { RollbackButton } from "@/components/shell/RollbackButton";

/**
 * Server component that fetches the latest data date and passes it to the client button.
 */
export async function RollbackButtonWrapper() {
  const svc = supabaseService();
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();

  let datasetMode: "own" | "competitor" = "own";
  if (user) {
    const { data: settings } = await svc
      .from("user_settings")
      .select("dataset_mode")
      .eq("user_id", user.id)
      .maybeSingle();
    datasetMode = normalizeDatasetMode(settings?.dataset_mode);
  }

  const { data: latestRow } =
    datasetMode === "competitor"
      ? await svc
          .schema("competitor")
          .from("playlist_daily_stats")
          .select("date")
          .order("date", { ascending: false })
          .limit(1)
          .maybeSingle()
      : await svc
          .from("playlist_daily_stats")
          .select("date")
          .order("date", { ascending: false })
          .limit(1)
          .maybeSingle();

  const latestRunDate = (latestRow as { date: string } | null)?.date ?? null;
  const latestDataDate = latestRunDate ? dataDateFromRunDate(latestRunDate) : null;

  return <RollbackButton latestDataDate={latestDataDate} datasetMode={datasetMode} />;
}
