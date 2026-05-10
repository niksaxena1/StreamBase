import { Suspense } from "react";
import type { Metadata } from "next";

import { LogoMark } from "@/components/LogoMark";
import LoginForm from "./ui";

// Login reads `useSearchParams()` in a client component (next redirect), so avoid SSG/ISR prerender.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Login",
};

export default function LoginPage() {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden p-3">
      {/* Background Ambience */}
      <div className="pointer-events-none absolute inset-0">
        <div className="sb-accent-glow absolute left-1/2 top-1/2 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 opacity-40" />
      </div>

      <div className="relative w-full max-w-sm">
        {/* Logo / Brand */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex justify-center">
            <LogoMark size={96} />
          </div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            SBase
          </h1>
          <p className="mt-2 text-sm dark:text-white/80">
            Sign in to your analytics dashboard
          </p>
        </div>

        {/* Card */}
        <div className="sb-glass p-4 shadow-2xl backdrop-blur-2xl">
          <Suspense fallback={<div className="text-sm opacity-60">Loading…</div>}>
            <LoginForm />
          </Suspense>
        </div>
        
        <div className="mt-4 text-center text-[11px] opacity-40">
          &copy; {new Date().getFullYear()} SBase. Internal use only.
        </div>
      </div>
    </div>
  );
}
