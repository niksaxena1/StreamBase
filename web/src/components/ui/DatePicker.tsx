"use client";

import { useRouter } from "next/navigation";
import { Calendar } from "lucide-react";
import { Suspense } from "react";

function DatePickerInner({
  value,
  min,
  max,
  label,
  path,
}: {
  value: string;
  min?: string;
  max?: string;
  label?: string;
  path: string;
}) {
  const router = useRouter();

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const newDate = e.target.value;
    if (!newDate) return;

    const params = new URLSearchParams(window.location.search);
    params.set("date", newDate);
    router.push(`${path}?${params.toString()}`);
  }

  return (
    <div className="flex items-center gap-2">
      {label ? (
        <label className="text-sm font-medium" style={{ color: "var(--sb-muted)" }}>
          {label}:
        </label>
      ) : null}
      <div className="sb-ring flex items-center gap-2 rounded-2xl bg-white/70 px-3 py-2 dark:bg-white/5">
        <Calendar className="h-4 w-4 opacity-60" />
        <input
          type="date"
          value={value}
          min={min}
          max={max}
          onChange={handleChange}
          className="bg-transparent text-sm outline-none"
          style={{ color: "var(--sb-text)" }}
        />
      </div>
    </div>
  );
}

export function DatePicker({
  value,
  min,
  max,
  label,
  path,
}: {
  value: string;
  min?: string;
  max?: string;
  label?: string;
  path: string;
}) {
  return (
    <Suspense fallback={<div className="h-10 w-32 animate-pulse rounded-2xl bg-white/30 dark:bg-white/10" />}>
      <DatePickerInner value={value} min={min} max={max} label={label} path={path} />
    </Suspense>
  );
}
