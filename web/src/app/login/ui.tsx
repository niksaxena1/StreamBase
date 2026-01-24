"use client";

import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { supabaseBrowser } from "@/lib/supabase/client";

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
        <div className="rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-950">
          {error}
        </div>
      ) : null}

      <div>
        <label className="text-xs font-medium" style={{ color: "var(--sb-muted)" }}>
          Email
        </label>
        <input
          className="mt-1 w-full rounded-2xl border bg-white/70 px-4 py-3 text-sm outline-none focus:ring-2"
          style={{ borderColor: "var(--sb-border)" }}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>

      <div>
        <label className="text-xs font-medium" style={{ color: "var(--sb-muted)" }}>
          Password
        </label>
        <input
          className="mt-1 w-full rounded-2xl border bg-white/70 px-4 py-3 text-sm outline-none focus:ring-2"
          style={{ borderColor: "var(--sb-border)" }}
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
        className="w-full rounded-2xl bg-black px-4 py-3 text-sm font-medium text-white transition disabled:opacity-60"
      >
        {loading ? "Logging in…" : "Log in"}
      </button>
    </form>
  );
}

