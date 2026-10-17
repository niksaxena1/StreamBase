"use client";

import { AlertTriangle } from "lucide-react";

import type { AttentionCount, LibraryAttention } from "@/lib/library/attention";

import { LibraryToolbarPopover } from "./LibraryToolbarPopover";

/** Dropdown list of things worth fixing, one clickable row per rule. Rules with no matches are left out. */
export function LibraryAttentionPanel({
  counts,
  active,
  onPick,
}: {
  counts: AttentionCount[];
  active: LibraryAttention | "";
  onPick: (rule: LibraryAttention) => void;
}) {
  const total = counts.reduce((sum, c) => sum + c.count, 0);
  if (total === 0) return null;
  return (
    <LibraryToolbarPopover warning label={`Needs attention: ${total.toLocaleString("en-US")}`} trigger={
      <span className="flex items-center gap-1">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
        {total.toLocaleString("en-US")}
      </span>
    }>
      {(close) => (
        <div>
          <p className="mb-2 text-xs font-medium" style={{ color: "var(--sb-warning)" }}>Needs attention</p>
          <ul className="space-y-1">
            {counts.map((c) => (
              <li key={c.rule}>
                <button
                  type="button"
                  aria-pressed={active === c.rule}
                  onClick={() => { onPick(c.rule); close(); }}
                  className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-[var(--sb-row-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sb-accent)]"
                  style={active === c.rule ? { background: "var(--sb-accent-10)" } : undefined}
                >
                  <span>{c.label}</span>
                  <span className="tabular-nums" style={{ color: "var(--sb-muted)" }}>{c.count.toLocaleString("en-US")}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </LibraryToolbarPopover>
  );
}
