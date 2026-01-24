import LoginForm from "./ui";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <div className="mx-auto max-w-md">
      <div className="sb-card rounded-[28px] p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Log in</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--sb-muted)" }}>
          Admin access to SpotiBase.
        </p>
        <div className="mt-6">
          <LoginForm />
        </div>
      </div>
    </div>
  );
}

