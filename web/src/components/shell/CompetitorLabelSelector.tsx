"use client";

import Image from "next/image";
import { useMemo, useState } from "react";

type Label = { label_key: string; display_name: string; image_url: string | null };

export function CompetitorLabelSelector({
  labels,
  initialLabelKey,
}: {
  labels: Label[];
  initialLabelKey: string | null;
}) {
  const [value, setValue] = useState(initialLabelKey ?? labels[0]?.label_key ?? "");
  const [saving, setSaving] = useState(false);
  const activeLabel = useMemo(
    () => labels.find((label) => label.label_key === value) ?? labels[0] ?? null,
    [labels, value],
  );

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
      {activeLabel?.image_url ? (
        <Image
          src={activeLabel.image_url}
          alt={activeLabel.display_name}
          width={18}
          height={18}
          className="h-[18px] w-[18px] rounded object-cover sb-ring"
        />
      ) : (
        <span className="h-[18px] w-[18px] rounded bg-fuchsia-500/15 sb-ring" />
      )}
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
