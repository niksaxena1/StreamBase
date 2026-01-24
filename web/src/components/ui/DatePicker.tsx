"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Calendar } from "lucide-react";

export function DatePicker({
  value,
  min,
  max,
  label,
}: {
  value: string;
  min?: string;
  max?: string;
  label?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const newDate = e.target.value;
    if (!newDate) return;

    const params = new URLSearchParams(searchParams.toString());
    params.set("date", newDate);
    router.push(`?${params.toString()}`);
  }

  return (
    <div className="flex items-center gap-2">
      {label ? (
        <label className="text-sm font-medium" style={{ color: "var(--sb-muted)" }}>
          {label}:
        </label>
      ) : null}
      <div className="sb-ring flex items-center gap-2 rounded-2xl bg-white/70 px-3 py-2">
        <Calendar className="h-4 w-4 opacity-60" />
        <input
          type="date"
          value={value}
          min={min}
          max={max}
          onChange={handleChange}
          className="bg-transparent text-sm outline-none"
        />
      </div>
    </div>
  );
}
