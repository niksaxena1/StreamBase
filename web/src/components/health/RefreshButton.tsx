"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";

/**
 * Refresh button that re-runs the server component data fetch via router.refresh().
 * Shows a spinning animation while the refresh is in progress.
 */
export function RefreshButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [spin, setSpin] = useState(false);

  const handleClick = useCallback(() => {
    setSpin(true);
    startTransition(() => {
      router.refresh();
    });
    // Keep the spin animation for at least 600ms so it's visible even on fast refreshes.
    setTimeout(() => setSpin(false), 600);
  }, [router]);

  const spinning = isPending || spin;

  return (
    <button
      onClick={handleClick}
      disabled={isPending}
      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors hover:opacity-80 disabled:opacity-50"
      style={{ backgroundColor: "var(--sb-surface)", color: "var(--sb-text)" }}
      title="Refresh health data"
    >
      <RefreshCw
        className={["h-3.5 w-3.5", spinning ? "animate-spin" : ""].join(" ")}
      />
      <span className="hidden sm:inline">Refresh</span>
    </button>
  );
}
