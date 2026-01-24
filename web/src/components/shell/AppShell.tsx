import { ReactNode } from "react";

import { PillNav } from "@/components/shell/PillNav";
import { SideRail } from "@/components/shell/SideRail";
import { LogoutButton } from "@/components/shell/LogoutButton";
import { ThemeToggle } from "@/components/shell/ThemeToggle";

export function AppShell(props: { children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      {/* subtle accent glow */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-24 -top-24">
          <div 
            className="sb-accent-glow h-[520px] w-[520px] opacity-70" 
            style={{ animationDelay: "0s" }}
          />
        </div>
        <div className="absolute -right-40 top-24">
          <div 
            className="sb-accent-glow h-[560px] w-[560px] opacity-50" 
            style={{ animationDelay: "-5s", animationDuration: "25s" }}
          />
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-[1320px] gap-6 px-4 py-6 pb-24 sm:pb-6">
        <SideRail />

        <div className="flex min-w-0 flex-1 flex-col gap-6">
          {/* Top bar with pill navigation (glass) */}
          <header className="sb-glass rounded-[28px] px-4 py-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="sb-ring grid h-10 w-10 place-items-center rounded-2xl bg-black text-white dark:bg-white dark:text-black">
                  <LogoMark />
                </div>
                <div>
                  <div className="font-serif text-lg font-semibold tracking-tight">
                    SpotiBase
                  </div>
                  <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
                    SpotOnTrack → Supabase
                  </div>
                </div>
              </div>

              <PillNav />

              <div className="flex items-center gap-2">
                <ThemeToggle />
                <LogoutButton />
              </div>
            </div>
          </header>

          {/* Main surface */}
          <main className="sb-glass rounded-[32px] p-6 sm:p-8">
            {props.children}
          </main>

          <footer className="px-2 pb-2 text-xs" style={{ color: "var(--sb-muted)" }}>
            Data source: SpotOnTrack exports • Updated daily via GitHub Actions
          </footer>
        </div>
      </div>
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
