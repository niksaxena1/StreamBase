import { redirect } from "next/navigation";

import { AppShell } from "@/components/shell/AppShell";
import { KeyboardShortcutsHelp, KeyboardShortcutsProvider } from "@/components/keyboard";
import { ChartAxisZoomProvider } from "@/components/charts/ChartAxisZoomContext";
import { ChartStartDateProvider } from "@/components/charts/ChartStartDateContext";
import { WeekHighlightProvider } from "@/components/charts/WeekHighlightContext";
import { WeekendDipProvider } from "@/components/charts/WeekendDipContext";
import { CurrencyDisplayProvider } from "@/components/currency/CurrencyDisplayContext";
import { MetricProvider } from "@/components/metrics/MetricContext";
import { PayoutRateProvider } from "@/components/payout/PayoutRateContext";
import { RollbackProvider } from "@/components/rollback/RollbackContext";
import { supabaseServer } from "@/lib/supabase/server";

export async function AuthedAppLayout({
  children,
  appShellProps,
}: {
  children: React.ReactNode;
  // Callers should not have to provide `children` inside `appShellProps`.
  appShellProps?: Omit<React.ComponentProps<typeof AppShell>, "children">;
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
          <CurrencyDisplayProvider>
            <ChartStartDateProvider>
              <ChartAxisZoomProvider>
                <WeekendDipProvider>
                  <MetricProvider defaultMetric="streams">
                    <RollbackProvider>
                      <AppShell {...appShellProps}>{children}</AppShell>
                      <KeyboardShortcutsHelp />
                    </RollbackProvider>
                  </MetricProvider>
                </WeekendDipProvider>
              </ChartAxisZoomProvider>
            </ChartStartDateProvider>
          </CurrencyDisplayProvider>
        </WeekHighlightProvider>
      </PayoutRateProvider>
    </KeyboardShortcutsProvider>
  );
}

