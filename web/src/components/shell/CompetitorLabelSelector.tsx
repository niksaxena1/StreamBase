"use client";

import Image from "next/image";
import { useState } from "react";
import { MenuSelect } from "@/components/ui/MenuSelect";
import { ALL_COMPETITORS_KEY } from "@/lib/competitorContext";

type Label = { label_key: string; display_name: string; image_url: string | null };

export function CompetitorLabelSelector({
  labels,
  initialLabelKey,
}: {
  labels: Label[];
  initialLabelKey: string | null;
}) {
  const [value, setValue] = useState(initialLabelKey ?? ALL_COMPETITORS_KEY);
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

  const options = [
    {
      value: ALL_COMPETITORS_KEY,
      label: "All",
      leading: <span className="grid h-[18px] w-[18px] place-items-center rounded bg-lime-500/15 text-[10px] font-semibold sb-ring">All</span>,
    },
    ...labels.map((label) => ({
    value: label.label_key,
    label: label.display_name,
    leading: label.image_url ? (
      <Image
        src={label.image_url}
        alt=""
        width={18}
        height={18}
        className="h-[18px] w-[18px] rounded object-cover sb-ring"
      />
    ) : (
      <span className="block h-[18px] w-[18px] rounded bg-fuchsia-500/15 sb-ring" />
    ),
    })),
  ];

  return (
    <MenuSelect
      value={value}
      options={options}
      onChange={update}
      disabled={saving}
      ariaLabel="Select competitor"
      className="min-w-[124px]"
      buttonClassName="h-8 rounded-full px-2.5 py-1.5"
      menuClassName="min-w-[160px]"
      matchTriggerWidth={false}
    />
  );
}
