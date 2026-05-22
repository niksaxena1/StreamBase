import { redirect } from "next/navigation";

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
import { normalizeDatasetMode } from "@/lib/datasetMode";
import { resolveCompetitorLabelKey } from "@/lib/competitorContext";
import { normalizeAppAccess } from "@/lib/appAccess";

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

  const { data: settings } = await svc
    .from("user_settings")
    .select("dataset_mode,competitor_label_key")
    .eq("user_id", session.user.id)
    .maybeSingle();
  const datasetMode = normalizeDatasetMode(settings?.dataset_mode);
  const competitorLabels =
    datasetMode === "competitor"
      ? (
          (
            await svc
              .schema("competitor")
              .from("labels")
              .select("label_key,display_name")
              .eq("is_active", true)
              .order("display_name", { ascending: true })
          ).data ?? []
        )
      : [];
  const competitorPlaylistRows =
    datasetMode === "competitor"
      ? (
          (
            await svc
              .schema("competitor")
              .from("playlists")
              .select("label_key,spotify_playlist_image_url,display_order")
              .eq("is_active", true)
              .order("display_order", { ascending: true, nullsFirst: false })
          ).data ?? []
        )
      : [];
  const competitorImageByLabel = new Map<string, string | null>();
  for (const playlist of competitorPlaylistRows as Array<{ label_key: string; spotify_playlist_image_url: string | null }>) {
    if (!competitorImageByLabel.has(playlist.label_key)) {
      competitorImageByLabel.set(playlist.label_key, playlist.spotify_playlist_image_url ?? null);
    }
  }
  const competitorLabelsWithImages = competitorLabels.map((label) => ({
    ...label,
    image_url: competitorImageByLabel.get(label.label_key) ?? null,
  }));
  const competitorLabelKey = resolveCompetitorLabelKey(settings?.competitor_label_key, competitorLabels);

  return (
    <KeyboardShortcutsProvider>
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
                          datasetMode={datasetMode}
                          appAccess={appAccess}
                          competitorLabels={competitorLabelsWithImages}
                          competitorLabelKey={competitorLabelKey}
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

