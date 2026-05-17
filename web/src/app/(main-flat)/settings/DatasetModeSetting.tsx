"use client";

import { useState } from "react";

import type { DatasetMode } from "@/lib/datasetMode";
import { Button } from "@/components/ui/Button";

export function DatasetModeSetting({ initialMode }: { initialMode: DatasetMode }) {
  const [mode, setMode] = useState<DatasetMode>(initialMode);
  const [saving, setSaving] = useState(false);

  async function update(nextMode: DatasetMode) {
    setSaving(true);
    try {
      const res = await fetch("/api/user-settings/dataset-mode", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataset_mode: nextMode }),
      });
      if (res.ok) setMode(nextMode);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 text-xs" style={{ color: "var(--sb-muted)" }}>
      <div>
        Switch the entire analytical universe. <strong style={{ color: "var(--sb-text)" }}>Own Catalog</strong>{" "}
        shows your releases; <strong style={{ color: "var(--sb-text)" }}>Competitor Mode</strong> shows the tracked competitor estate instead.
      </div>
      <div className="flex gap-2">
        <Button disabled={saving || mode === "own"} onClick={() => update("own")}>
          Own Catalog
        </Button>
        <Button disabled={saving || mode === "competitor"} onClick={() => update("competitor")}>
          Competitor Mode
        </Button>
      </div>
    </div>
  );
}
