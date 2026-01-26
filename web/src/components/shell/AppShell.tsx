import { ReactNode } from "react";
import Link from "next/link";

import { LogoMark } from "@/components/LogoMark";
import { SideRail } from "@/components/shell/SideRail";
import { MobileNav } from "@/components/shell/MobileNav";
import { Breadcrumbs } from "@/components/shell/Breadcrumbs";
import { LogoutButton } from "@/components/shell/LogoutButton";
import { ThemeToggle } from "@/components/shell/ThemeToggle";

export function AppShell(props: { children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      {/* subtle accent glow */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
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

      <div className="mx-auto flex w-full max-w-[1600px] gap-3 px-3 py-3 pb-24 sm:pb-3">
        <SideRail />

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {/* Top bar with breadcrumbs (glass) */}
          <header className="sb-glass px-3 py-2">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Link href="/" className="transition-opacity hover:opacity-80">
                  <LogoMark />
                </Link>
                <div className="flex items-center gap-2">
                  <div className="font-display text-sm font-semibold tracking-tight">
                    SpotiBase
                  </div>
                  <Breadcrumbs />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <ThemeToggle />
                <LogoutButton />
              </div>
            </div>
          </header>

          {/* Main surface */}
          <main className="sb-glass flex-1 p-4 sm:p-5">
            {props.children}
          </main>

          <footer className="px-2 pb-2 text-xs" style={{ color: "var(--sb-muted)" }}>
            Data source: SpotOnTrack exports • Updated daily via GitHub Actions
          </footer>
        </div>
      </div>

      {/* Mobile Navigation */}
      <MobileNav />
    </div>
  );
}

