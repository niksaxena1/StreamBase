import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { KeyboardShortcutsHelp, KeyboardShortcutsProvider } from "@/components/keyboard";
import { ChartAxisZoomProvider } from "@/components/charts/ChartAxisZoomContext";
import { ChartStartDateProvider } from "@/components/charts/ChartStartDateContext";
import { WeekHighlightProvider } from "@/components/charts/WeekHighlightContext";
import { WeekendDipProvider } from "@/components/charts/WeekendDipContext";
import { CurrencyDisplayProvider } from "@/components/currency/CurrencyDisplayContext";
import { MetricProvider } from "@/components/metrics/MetricContext";
import { PayoutRateProvider } from "@/components/payout/PayoutRateContext";
import { RevenueDecimalDisplayProvider } from "@/components/revenue/RevenueDecimalDisplayContext";
import { RollbackProvider } from "@/components/rollback/RollbackContext";
import { AppShell } from "@/components/shell/AppShell";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { streamBaseAccessRedirectPath } from "@/lib/appAccess";
import { getRequestAppContext } from "@/lib/requestAppContext.server";

export async function AuthedAppLayout({
  children,
  appShellProps,
}: {
  children: React.ReactNode;
  // Callers should not have to provide `children` inside `appShellProps`.
  appShellProps?: Omit<React.ComponentProps<typeof AppShell>, "children">;
}) {
  const context = await getRequestAppContext();
  const { user, appAccess, shellContext } = context;

  if (!user) {
    // Middleware should already redirect, but keep a hard server-side guard.
    redirect("/login");
  }

  const pathname = (await headers()).get("x-spotibase-pathname") ?? "";
  const isPlaylistWatchPath = pathname === "/playlist-watch" || pathname.startsWith("/playlist-watch/");
  const streamBaseRedirect = streamBaseAccessRedirectPath(appAccess);
  if (streamBaseRedirect && !isPlaylistWatchPath) {
    redirect(streamBaseRedirect);
  }

  return (
    <KeyboardShortcutsProvider appAccess={appAccess} datasetMode={shellContext.datasetMode}>
      <PayoutRateProvider>
        <WeekHighlightProvider>
          <CurrencyDisplayProvider>
            <ChartStartDateProvider>
              <ChartAxisZoomProvider>
                <WeekendDipProvider>
                  <MetricProvider defaultMetric="streams">
                    <RevenueDecimalDisplayProvider>
                      <RollbackProvider>
                        <AppShell
                          {...appShellProps}
                          datasetMode={shellContext.datasetMode}
                          appAccess={appAccess}
                          userEmail={user.email ?? null}
                          suppressDatasetModeChrome={isPlaylistWatchPath}
                          competitorLabels={shellContext.competitorLabels}
                          competitorLabelKey={shellContext.competitorLabelKey}
                          competitorAccentHex={shellContext.competitorAccentHex}
                          competitorDisplayName={shellContext.competitorDisplayName}
                        >
                          <ErrorBoundary>{children}</ErrorBoundary>
                        </AppShell>
                        <KeyboardShortcutsHelp />
                      </RollbackProvider>
                    </RevenueDecimalDisplayProvider>
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
