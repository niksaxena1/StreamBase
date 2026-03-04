"use client";

import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { supabaseBrowser } from "@/lib/supabase/client";
import { Alert } from "@/components/ui/Alert";

export default function LoginForm() {
  const sp = useSearchParams();
  const next = useMemo(() => sp.get("next") || "/", [sp]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const sb = supabaseBrowser();
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
        return;
      }
      // middleware will redirect away from /login if session exists
      window.location.href = next;
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      {error ? (
        <Alert variant="error" title="Login failed">
          {error}
        </Alert>
      ) : null}

      <div className="space-y-1.5">
        <label htmlFor="login-email" className="text-xs font-medium" style={{ color: "var(--sb-muted)" }}>
          Email
        </label>
        <input
          id="login-email"
          className="w-full rounded-2xl border border-black/10 bg-white/70 px-4 py-3 text-sm outline-none transition focus:border-black/20 focus:ring-2 focus:ring-black/5 dark:border-white/10 dark:bg-white/5 dark:text-white dark:focus:border-white/20 dark:focus:ring-white/5"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="login-password" className="text-xs font-medium" style={{ color: "var(--sb-muted)" }}>
          Password
        </label>
        <input
          id="login-password"
          className="w-full rounded-2xl border border-black/10 bg-white/70 px-4 py-3 text-sm outline-none transition focus:border-black/20 focus:ring-2 focus:ring-black/5 dark:border-white/10 dark:bg-white/5 dark:text-white dark:focus:border-white/20 dark:focus:ring-white/5"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-2xl bg-black px-4 py-3 text-sm font-bold text-white transition hover:bg-black/80 hover:shadow-lg disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-white/90"
      >
        {loading ? "Logging in…" : "Log in"}
      </button>
    </form>
  );
}
