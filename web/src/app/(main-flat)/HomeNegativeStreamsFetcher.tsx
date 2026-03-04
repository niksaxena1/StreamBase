import { supabaseService } from "@/lib/supabase/service";
import { cachedQuery } from "@/lib/supabase/cache";
import { CACHE_TTL_1H } from "@/lib/constants";
import { HomeNegativeStreamsSection } from "./home/HomeNegativeStreamsSection";
import type { NegativeDailyStreamsRow } from "./home/homeTypes";

export async function HomeNegativeStreamsFetcher({
  userId,
}: {
  userId: string;
}) {
  const svc = supabaseService();

  const { data: negativeDailyStreams } = await cachedQuery(
    async () => {
      return await svc.rpc("home_negative_daily_streams");
    },
    `home-negative-daily-v2-${userId}`,
    CACHE_TTL_1H,
  );

  return (
    <HomeNegativeStreamsSection
      negativeDailyStreams={(negativeDailyStreams as NegativeDailyStreamsRow[] | null) ?? []}
    />
  );
}
