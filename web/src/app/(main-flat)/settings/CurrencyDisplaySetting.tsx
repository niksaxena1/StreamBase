"use client";

import { useEffect, useState } from "react";

import { Chip, ChipGroup } from "@/components/ui/Chip";
import type { CurrencyDisplay } from "@/lib/format";

function parseCurrency(raw: unknown): CurrencyDisplay {
  const s = String(raw ?? "").trim().toUpperCase();
  return s === "AED" ? "AED" : "USD";
}

export function CurrencyDisplaySetting() {
  const [value, setValue] = useState<CurrencyDisplay>("USD");
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    void fetch("/api/user-settings/currency-display")
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((data as any)?.error ?? "Failed to load setting");
        return data;
      })
      .then((data) => {
        setValue(parseCurrency((data as any)?.currency_display));
        setConfigured((data as any)?.configured !== false);
        setLoading(false);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Failed to load setting");
        setLoading(false);
      });
  }, []);

  async function save(next: CurrencyDisplay) {
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const res = await fetch("/api/user-settings/currency-display", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currency_display: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any)?.error ?? "Failed to update setting");

      setValue(parseCurrency((data as any)?.currency_display));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);

      // Let the app update without a full reload (best-effort).
      window.dispatchEvent(new Event("sb:currency-display-updated"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update setting");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="sb-ring rounded-2xl bg-white/70 p-3 dark:bg-white/5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <h3 className="text-sm font-medium">Currency display</h3>
          <p className="mt-1 text-xs opacity-70">
            Display all money values in USD or AED (AED = USD × 3.6725).
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
          <div className="text-[10px] opacity-60">Default: USD</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ChipGroup segmented className="text-[11px]">
          {(["USD", "AED"] as const).map((c) => (
            <Chip
              key={c}
              segmented
              selected={value === c}
              onClick={() => void save(c)}
              disabled={loading || saving || !configured}
              title={c === "USD" ? "Show USD ($)" : "Show AED (Dirham symbol)"}
            >
              {c === "USD" ? "USD ($)" : "AED (د.إ)"}
            </Chip>
          ))}
        </ChipGroup>
      </div>
    </div>
  );
}

