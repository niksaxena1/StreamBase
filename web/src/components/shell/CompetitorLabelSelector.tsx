"use client";

import { useState } from "react";

type Label = { label_key: string; display_name: string };

export function CompetitorLabelSelector({
  labels,
  initialLabelKey,
}: {
  labels: Label[];
  initialLabelKey: string | null;
}) {
  const [value, setValue] = useState(initialLabelKey ?? labels[0]?.label_key ?? "");
  const [saving, setSaving] = useState(false);

  if (!labels.length) return null;

  async function update(nextValue: string) {
    setValue(nextValue);
    setSaving(true);
    try {
      await fetch("/api/user-settings/competitor-label", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ competitor_label_key: nextValue }),
      });
      window.location.reload();
    } finally {
      setSaving(false);
    }
  }

  return (
    <label className="flex items-center gap-1 text-[11px]" style={{ color: "var(--sb-muted)" }}>
      <span>Competitor</span>
      <select
        className="rounded-md border px-2 py-1 text-xs"
        style={{ borderColor: "var(--sb-border)", background: "var(--sb-surface)", color: "var(--sb-text)" }}
        value={value}
        disabled={saving}
        onChange={(event) => update(event.target.value)}
      >
        {labels.map((label) => (
          <option key={label.label_key} value={label.label_key}>
            {label.display_name}
          </option>
        ))}
      </select>
    </label>
  );
}
