"use client";

import { AlertTriangle } from "lucide-react";

import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import type { AttentionCount, LibraryAttention } from "@/lib/library/attention";

/** Collapsible list of things worth fixing, one clickable row per rule. Rules with no matches are left out. */
export function LibraryAttentionPanel({
  counts,
  active,
  onPick,
}: {
  counts: AttentionCount[];
  active: LibraryAttention | "";
  onPick: (rule: LibraryAttention) => void;
}) {
  if (counts.length === 0) return null;
  const total = counts.reduce((sum, c) => sum + c.count, 0);
  return (
    <CollapsibleSection
      title={
        <span className="inline-flex items-center gap-1.5">
          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
          Needs attention
        </span>
      }
      subtitle={`${total.toLocaleString("en-US")} ${total === 1 ? "item" : "items"}`}
      storageKey="sb:library:attention-open"
      defaultOpen
    >
      <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
        {counts.map((c) => {
          const selected = active === c.rule;
          return (
            <li key={c.rule}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => onPick(c.rule)}
                className={[
                  "flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-xs transition",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sb-accent)]",
                  selected ? "font-medium" : "hover:bg-[var(--sb-row-hover)]",
                ].join(" ")}
                style={selected ? { background: "var(--sb-accent-10)", boxShadow: "inset 0 0 0 1px var(--sb-accent-20)" } : undefined}
              >
                <span className="min-w-0 truncate">{c.label}</span>
                <span className="tabular-nums" style={{ color: "var(--sb-muted)" }}>
                  {c.count.toLocaleString("en-US")}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </CollapsibleSection>
  );
}
