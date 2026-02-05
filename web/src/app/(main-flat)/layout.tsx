import { AppShell } from "@/components/shell/AppShell";
import { supabaseServer } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { PayoutRateProvider } from "@/components/payout/PayoutRateContext";
import { MetricProvider } from "@/components/metrics/MetricContext";
import { WeekHighlightProvider } from "@/components/charts/WeekHighlightContext";

export default async function MainFlatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sb = await supabaseServer();
  const {
    data: { session },
  } = await sb.auth.getSession();

  if (!session) {
    // Middleware should already redirect, but keep a hard server-side guard.
    redirect("/login");
  }

  return (
    <PayoutRateProvider>
      <WeekHighlightProvider>
        <MetricProvider defaultMetric="streams">
          <AppShell mainSurface="plain">{children}</AppShell>
        </MetricProvider>
      </WeekHighlightProvider>
    </PayoutRateProvider>
  );
}

