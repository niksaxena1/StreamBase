import { ReactNode } from "react";

import { SideRail } from "@/components/shell/SideRail";
import { MobileNav } from "@/components/shell/MobileNav";
import { Breadcrumbs } from "@/components/shell/Breadcrumbs";
import { LogoutButton } from "@/components/shell/LogoutButton";
import { ThemeToggle } from "@/components/shell/ThemeToggle";

export function AppShell(props: { children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      {/* subtle accent glow */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
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
                <div className="sb-ring grid h-9 w-9 place-items-center rounded-xl bg-black text-white dark:bg-white dark:text-black">
                  <LogoMark />
                </div>
                <div>
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
          <main className="sb-glass p-4 sm:p-5">
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

function LogoMark() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M7 7.5C7 6.11929 8.11929 5 9.5 5H14.5C15.8807 5 17 6.11929 17 7.5V16.5C17 17.8807 15.8807 19 14.5 19H9.5C8.11929 19 7 17.8807 7 16.5V7.5Z"
        fill="currentColor"
        opacity="0.92"
      />
      <path
        d="M10 8.5H14"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        className="text-black dark:text-white"
      />
      <path
        d="M10 12H14"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        opacity="0.75"
        className="text-black dark:text-white"
      />
      <path
        d="M10 15.5H13"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        opacity="0.55"
        className="text-black dark:text-white"
      />
    </svg>
  );
}
