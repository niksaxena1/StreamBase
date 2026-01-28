import { LogoMark } from "@/components/LogoMark";
import LoginForm from "./ui";

export const revalidate = 86400; // 24h ISR - mostly static login UI

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
            SpotiBase
          </h1>
          <p className="mt-2 text-sm text-black/60 dark:text-white/60">
            Sign in to your analytics dashboard
          </p>
        </div>

        {/* Card */}
        <div className="sb-glass p-4 shadow-2xl backdrop-blur-2xl">
          <LoginForm />
        </div>
        
        <div className="mt-4 text-center text-[11px] opacity-40">
          &copy; {new Date().getFullYear()} SpotiBase. Internal use only.
        </div>
      </div>
    </div>
  );
}
