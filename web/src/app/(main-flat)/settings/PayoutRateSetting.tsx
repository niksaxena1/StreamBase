"use client";

import { useEffect, useMemo, useState } from "react";

function normalizeRateInput(raw: string) {
  const s = raw.trim();
  if (!s) return { ok: false as const, error: "Rate is required." };
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return { ok: false as const, error: "Up to 2 decimal places." };
  const n = Number(s);
  if (!Number.isFinite(n)) return { ok: false as const, error: "Rate must be a number." };
  if (n < 0) return { ok: false as const, error: "Rate must be non-negative." };
  return { ok: true as const, value: Math.round(n * 100) / 100 };
}

export function PayoutRateSetting() {
  const [rateText, setRateText] = useState("2");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const parsed = useMemo(() => normalizeRateInput(rateText), [rateText]);
  const perStream = parsed.ok ? parsed.value / 1000 : null;

  useEffect(() => {
    setLoading(true);
    setError(null);
    void fetch("/api/user-settings/rate")
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((data as any)?.error ?? "Failed to load rate");
        return data;
      })
      .then((data) => {
        const rate = Number((data as any)?.stream_payout_rate_per_k_usd ?? 2);
        setRateText(Number.isFinite(rate) ? String(rate) : "2");
        setConfigured((data as any)?.configured !== false);
        setLoading(false);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Failed to load rate");
        setLoading(false);
      });
  }, []);

  async function save() {
    setError(null);
    setSaved(false);

    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/user-settings/rate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stream_payout_rate_per_k_usd: parsed.value }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any)?.error ?? "Failed to update rate");

      const savedRate = Number((data as any)?.stream_payout_rate_per_k_usd ?? parsed.value);
      setRateText(Number.isFinite(savedRate) ? String(savedRate) : String(parsed.value));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);

      // Notify the app to refetch rate-dependent calculations.
      window.dispatchEvent(new Event("sb:payout-rate-updated"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update rate");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="sb-ring rounded-2xl bg-white/70 p-3 dark:bg-white/5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <h3 className="text-sm font-medium">Rate</h3>
          <p className="mt-1 text-xs opacity-70">
            Estimated revenue payout in <span className="font-mono">USD per 1,000 streams</span>. Example:{" "}
            <span className="font-mono">2</span> = <span className="font-mono">0.002</span> per stream.
          </p>
        </div>

        <div className="flex flex-col items-end gap-1">
          {loading ? (
            <div className="text-xs opacity-60">Loading…</div>
          ) : !configured ? (
            <div className="text-xs opacity-60">DB not migrated yet</div>
          ) : error ? (
            <div className="text-xs text-red-600 dark:text-red-400">{error}</div>
          ) : saved ? (
            <div className="text-xs text-green-600 dark:text-green-400">Saved</div>
          ) : null}
          {perStream != null ? (
            <div className="text-[10px] opacity-60">Per-stream: {perStream.toFixed(4)}</div>
          ) : (
            <div className="text-[10px] opacity-40">Per-stream: —</div>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <input
          type="text"
          inputMode="decimal"
          value={rateText}
          onChange={(e) => {
            setError(null);
            setSaved(false);
            setRateText(e.target.value);
          }}
          placeholder="2"
          className="sb-ring h-9 w-40 rounded-lg bg-white/60 px-3 text-sm dark:bg-white/10"
          disabled={loading || saving || !configured}
          aria-label="Rate (USD per 1,000 streams)"
        />

        <button
          type="button"
          onClick={save}
          disabled={loading || saving || !configured || !parsed.ok}
          className={[
            "sb-ring inline-flex h-9 items-center justify-center rounded-lg px-3 text-xs font-medium transition",
            "bg-black text-white hover:bg-black/90 dark:bg-white dark:text-black dark:hover:bg-white/90",
            (loading || saving || !configured || !parsed.ok) ? "opacity-40 cursor-not-allowed" : "",
          ].join(" ")}
        >
          {saving ? "Saving…" : "Save"}
        </button>

        {!parsed.ok && rateText.trim() ? (
          <div className="text-xs text-red-600 dark:text-red-400">{parsed.error}</div>
        ) : null}
      </div>
    </div>
  );
}

