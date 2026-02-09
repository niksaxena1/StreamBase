"use client";

import { type ReactNode, useEffect, useState } from "react";

/**
 * A collapsible section using native `<details>` with optional localStorage
 * persistence, matching the pattern used on the home dashboard.
 */
export function CollapsibleSection({
  title,
  subtitle,
  actions,
  storageKey,
  defaultOpen = false,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** localStorage key to persist open/closed state. Omit to skip persistence. */
  storageKey?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  // Restore persisted state on mount
  useEffect(() => {
    if (!storageKey) return;
    try {
      const v = localStorage.getItem(storageKey);
      if (v === "1" || v === "true") setOpen(true);
      else if (v === "0" || v === "false") setOpen(false);
    } catch {
      // ignore
    }
  }, [storageKey]);

  // Persist state changes
  useEffect(() => {
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, open ? "1" : "0");
    } catch {
      // ignore
    }
  }, [storageKey, open]);

  return (
    <details
      open={open}
      onToggle={(ev) => setOpen(ev.currentTarget.open)}
      className="rounded-xl border sb-panel p-3"
      style={{ borderColor: "var(--sb-border)" }}
    >
      <summary className="cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <span
              className="mt-0.5 flex-shrink-0 text-xs opacity-60 transition-transform duration-150"
              style={{ display: "inline-block", transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
            >
              ▸
            </span>
            <div className="min-w-0">
              <div className="text-[11px] font-medium uppercase tracking-wider opacity-60">
                {title}
              </div>
              {subtitle && (
                <div className="mt-0.5 text-[10px] opacity-40">{subtitle}</div>
              )}
            </div>
          </div>
          {actions && (
            <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>
          )}
        </div>
      </summary>

      <div className="mt-3">{children}</div>
    </details>
  );
}
