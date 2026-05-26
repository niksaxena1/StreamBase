import { ReactNode } from "react";
import Link from "next/link";

import { LogoMark } from "@/components/LogoMark";
import { SideRailWithBadge } from "@/components/shell/SideRailWithBadge";
import { MobileNavWithBadge } from "@/components/shell/MobileNavWithBadge";
import { Breadcrumbs } from "@/components/shell/Breadcrumbs";
import { SearchBar } from "@/components/shell/SearchBar";
import { IngestionStatusBanner } from "@/components/health/IngestionStatusBanner";
import { UserMenu } from "@/components/shell/UserMenu";
import { GlobalMetricToggle } from "@/components/shell/GlobalMetricToggle";
import { RollbackButtonWrapper } from "@/components/shell/RollbackButtonWrapper";
import { LazyAIWidget } from "@/components/sai/LazyAIWidget";
import { CompetitorModeButton } from "@/components/shell/CompetitorModeButton";
import { CompetitorTitleEffect } from "@/components/shell/CompetitorTitleEffect";
import { AppFooter } from "@/components/shell/AppFooter";
import { isPlaylistWatchOnlyAccess, type AppAccess } from "@/lib/appAccess";
import { competitorAccentCssVars } from "@/lib/competitorAccent";
import { APP_SHORT_NAME } from "@/lib/pageTitle";

type MainSurface = "glass" | "plain";

type CompetitorLabelProp = {
  label_key: string;
  display_name: string;
  image_url: string | null;
  accent_hex: string | null;
};

export function AppShell(props: {
  children: ReactNode;
  mainSurface?: MainSurface;
  datasetMode?: "own" | "competitor";
  appAccess?: AppAccess;
  userEmail?: string | null;
  suppressDatasetModeChrome?: boolean;
  competitorLabels?: CompetitorLabelProp[];
  competitorLabelKey?: string | null;
  competitorAccentHex?: string | null;
  competitorDisplayName?: string | null;
}) {
  const mainSurface = props.mainSurface ?? "glass";
  const datasetMode = props.datasetMode ?? "own";
  const appAccess = props.appAccess;
  const playlistWatchOnly = appAccess ? isPlaylistWatchOnlyAccess(appAccess) : false;
  const showCompetitorSwitcher = Boolean(appAccess?.competitor) && !playlistWatchOnly;
  const navDatasetMode = props.suppressDatasetModeChrome ? "own" : datasetMode;
  const homeHref = playlistWatchOnly ? "/playlist-watch" : "/";
  const accentVars = props.competitorAccentHex ? competitorAccentCssVars(props.competitorAccentHex) : "";

  return (
    <>
      {accentVars ? <style>{`:root,html,html[data-theme="dark"]{${accentVars}}`}</style> : null}
      <CompetitorTitleEffect
        datasetMode={datasetMode}
        competitorDisplayName={props.competitorDisplayName ?? null}
      />

      <MobileNavWithBadge datasetMode={navDatasetMode} appAccess={appAccess} />
      {playlistWatchOnly ? null : <LazyAIWidget />}

      <div className="sb-app-shell min-h-dvh" data-mode={datasetMode}>
        <div
          className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
          style={{ contain: "strict" }}
        >
          <div className="absolute -left-24 -top-24">
            <div
              className="sb-accent-glow h-[420px] w-[420px] opacity-45"
              style={{ animationDelay: "0s" }}
            />
          </div>
          <div className="absolute -right-40 top-24">
            <div
              className="sb-accent-glow h-[460px] w-[460px] opacity-35"
              style={{ animationDelay: "-5s", animationDuration: "25s" }}
            />
          </div>
        </div>

        <div className="mx-auto flex w-full max-w-[1600px] gap-3 px-3 py-3 pb-[calc(72px+env(safe-area-inset-bottom,0px)+24px)] sm:pb-3">
          <SideRailWithBadge datasetMode={navDatasetMode} appAccess={appAccess} />

          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <header className="sb-glass relative z-20 px-3 py-2">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Link href={homeHref} className="transition-opacity hover:opacity-80" suppressHydrationWarning>
                    <LogoMark />
                  </Link>
                  <div className="flex items-center gap-2">
                    <Link
                      href={homeHref}
                      className="font-display text-sm font-semibold tracking-tight transition-opacity hover:opacity-80"
                      suppressHydrationWarning
                    >
                      {APP_SHORT_NAME}
                    </Link>
                    <Breadcrumbs />
                  </div>
                </div>

                <div className="flex min-w-0 flex-1 items-center gap-3 sm:flex-initial">
                  {playlistWatchOnly ? null : (
                    <div className="w-full max-w-xs sm:w-64 lg:w-80 xl:w-96">
                      <SearchBar datasetMode={datasetMode} />
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {playlistWatchOnly ? null : (
                    <>
                      {showCompetitorSwitcher ? (
                        <CompetitorModeButton
                          datasetMode={datasetMode}
                          labels={props.competitorLabels ?? []}
                          activeLabelKey={props.competitorLabelKey ?? null}
                        />
                      ) : null}
                      <RollbackButtonWrapper />
                      <GlobalMetricToggle />
                    </>
                  )}
                  <UserMenu appAccess={appAccess} userEmail={props.userEmail} />
                </div>
              </div>
            </header>

            <main
              id="main-content"
              className={(mainSurface === "glass" ? "sb-glass-solid " : "") + "flex-1 px-3 py-3"}
            >
              <IngestionStatusBanner />
              {props.children}
            </main>

            <AppFooter />
          </div>
        </div>
      </div>
    </>
  );
}


