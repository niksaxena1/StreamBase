import { AppShell } from "@/components/shell/AppShell";
import { supabaseServer } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { PayoutRateProvider } from "@/components/payout/PayoutRateContext";
import { MetricProvider } from "@/components/metrics/MetricContext";

export default async function MainLayout({
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
      <MetricProvider defaultMetric="streams">
        <AppShell>{children}</AppShell>
      </MetricProvider>
    </PayoutRateProvider>
  );
}
