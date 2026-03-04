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

type MainSurface = "glass" | "plain";

export function AppShell(props: { children: ReactNode; mainSurface?: MainSurface }) {
  const mainSurface = props.mainSurface ?? "glass";
  return (
    <>
      {/* 
        Mobile Navigation - MUST be outside the main container hierarchy.
        Placing fixed elements inside containers with transforms, filters, 
        or will-change can break fixed positioning in mobile browsers.
      */}
      <MobileNavWithBadge />

      {/* SAI (SpotiBase AI) assistant - also outside main hierarchy */}
      <LazyAIWidget />

      <div className="sb-app-shell min-h-dvh">
        {/* subtle accent glow - isolated with contain to prevent affecting fixed children */}
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
          <SideRailWithBadge />

          <div className="flex min-w-0 flex-1 flex-col gap-3">
            {/* Top bar with breadcrumbs (glass) */}
            <header className="sb-glass px-3 py-2 relative z-20">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Link href="/" className="transition-opacity hover:opacity-80" suppressHydrationWarning>
                    <LogoMark />
                  </Link>
                  <div className="flex items-center gap-2">
                    <Link
                      href="/"
                      className="font-display text-sm font-semibold tracking-tight transition-opacity hover:opacity-80"
                      suppressHydrationWarning
                    >
                      SpotiBase
                    </Link>
                    <Breadcrumbs />
                  </div>
                </div>

                <div className="flex items-center gap-3 min-w-0 flex-1 sm:flex-initial">
                  <div className="w-full max-w-xs sm:w-64 lg:w-80 xl:w-96">
                    <SearchBar />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <RollbackButtonWrapper />
                  <GlobalMetricToggle />
                  <UserMenu />
                </div>
              </div>
            </header>

            {/* Main surface - use sb-glass-solid so child FilterBars can have working backdrop-filter */}
            <main id="main-content" className={(mainSurface === "glass" ? "sb-glass-solid " : "") + "flex-1 px-3 py-3"}>
              <IngestionStatusBanner />
              {props.children}
            </main>

            <footer className="px-2 pb-2 text-xs" style={{ color: "var(--sb-muted)" }}>
              Data source:{" "}
              <a
                href="https://www.spotontrack.com/dashboard"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                SpotOnTrack
              </a>
              {" "}exports • Updated daily via{" "}
              <a
                href="https://github.com/niksaxena1/SpotiBase/actions"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                GitHub Actions
              </a>
            </footer>
          </div>
        </div>
      </div>
    </>
  );
}

