import { AppShell } from "@/components/shell/AppShell";
import { supabaseServer } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { PayoutRateProvider } from "@/components/payout/PayoutRateContext";
import { MetricProvider } from "@/components/metrics/MetricContext";
import { WeekHighlightProvider } from "@/components/charts/WeekHighlightContext";
import { RollbackProvider } from "@/components/rollback/RollbackContext";
import { KeyboardShortcutsProvider, KeyboardShortcutsHelp } from "@/components/keyboard";

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
    <KeyboardShortcutsProvider>
      <PayoutRateProvider>
        <WeekHighlightProvider>
          <MetricProvider defaultMetric="streams">
            <RollbackProvider>
              <AppShell>{children}</AppShell>
              <KeyboardShortcutsHelp />
            </RollbackProvider>
          </MetricProvider>
        </WeekHighlightProvider>
      </PayoutRateProvider>
    </KeyboardShortcutsProvider>
  );
}
