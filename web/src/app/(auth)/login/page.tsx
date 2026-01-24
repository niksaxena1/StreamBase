import LoginForm from "./ui";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden p-6">
      {/* Background Ambience */}
      <div className="pointer-events-none absolute inset-0">
        <div className="sb-accent-glow absolute left-1/2 top-1/2 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 opacity-40" />
      </div>

      <div className="relative w-full max-w-sm">
        {/* Logo / Brand */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-3xl bg-black text-white shadow-xl dark:bg-white dark:text-black">
            <LogoMark />
          </div>
          <h1 className="font-display text-3xl font-bold tracking-tight">SpotiBase</h1>
          <p className="mt-2 text-sm" style={{ color: "var(--sb-muted)" }}>
            Sign in to your analytics dashboard
          </p>
        </div>

        {/* Card */}
        <div className="sb-glass rounded-[32px] p-8 shadow-2xl backdrop-blur-2xl">
          <LoginForm />
        </div>
        
        <div className="mt-8 text-center text-xs opacity-40">
          &copy; {new Date().getFullYear()} SpotiBase. Internal use only.
        </div>
      </div>
    </div>
  );
}

function LogoMark() {
  return (
    <svg
      width="32"
      height="32"
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
