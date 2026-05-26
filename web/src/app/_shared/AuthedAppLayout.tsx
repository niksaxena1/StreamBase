import { redirect } from "next/navigation";

import { headers } from "next/headers";



import { AppShell } from "@/components/shell/AppShell";

import { ErrorBoundary } from "@/components/ui/ErrorBoundary";

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
import { supabaseServer } from "@/lib/supabase/server";

import { supabaseService } from "@/lib/supabase/service";

import { getCompetitorShellContext } from "@/lib/competitorContext.server";

import { normalizeAppAccess, streamBaseAccessRedirectPath } from "@/lib/appAccess";



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



  const svc = supabaseService();

  const { data: isAdmin } = await sb.rpc("is_admin");

  const { data: accessRow } = await svc

    .from("app_user_access")

    .select("own_catalog,competitor,playlist_watch,playlist_watch_admin")

    .eq("user_id", session.user.id)

    .maybeSingle();

  const appAccess = normalizeAppAccess(accessRow, Boolean(isAdmin));

  const pathname = (await headers()).get("x-spotibase-pathname") ?? "";

  const isPlaylistWatchPath = pathname === "/playlist-watch" || pathname.startsWith("/playlist-watch/");

  const streamBaseRedirect = streamBaseAccessRedirectPath(appAccess);

  if (streamBaseRedirect && !isPlaylistWatchPath) {

    redirect(streamBaseRedirect);

  }



  const shellContext = await getCompetitorShellContext();



  return (

    <KeyboardShortcutsProvider appAccess={appAccess}>

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

                          userEmail={session.user.email ?? null}

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



