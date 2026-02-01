"use client";

import { useRef, useState } from "react";

type DateParts = { day: number; month: number; year: number };

export function DateInput(props: { value?: Date; onChange: (date: Date) => void }) {
  const { value, onChange } = props;
  const [date, setDate] = useState<DateParts>(() => {
    const d = value ? new Date(value) : new Date();
    return { day: d.getDate(), month: d.getMonth() + 1, year: d.getFullYear() };
  });

  const dayRef = useRef<HTMLInputElement | null>(null);
  const monthRef = useRef<HTMLInputElement | null>(null);
  const yearRef = useRef<HTMLInputElement | null>(null);
  const initialDate = useRef<DateParts>(date);

  function validate(field: keyof DateParts, v: number, current: DateParts): boolean {
    if (
      (field === "day" && (v < 1 || v > 31)) ||
      (field === "month" && (v < 1 || v > 12)) ||
      (field === "year" && (v < 1000 || v > 9999))
    ) {
      return false;
    }

    const candidate = { ...current, [field]: v } as DateParts;
    const d = new Date(candidate.year, candidate.month - 1, candidate.day);
    return d.getFullYear() === candidate.year && d.getMonth() + 1 === candidate.month && d.getDate() === candidate.day;
  }

  const handleInputChange =
    (field: keyof DateParts) => (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value ? Number(e.target.value) : NaN;
      const next = { ...date, [field]: Number.isNaN(newValue) ? date[field] : newValue } as DateParts;
      setDate(next);

      if (!Number.isNaN(newValue) && validate(field, newValue, next)) {
        onChange(new Date(next.year, next.month - 1, next.day));
      }
    };

  const handleBlur =
    (field: keyof DateParts) => (e: React.FocusEvent<HTMLInputElement>) => {
      if (!e.target.value) {
        setDate(initialDate.current);
        return;
      }
      const newValue = Number(e.target.value);
      if (Number.isNaN(newValue) || !validate(field, newValue, date)) {
        setDate(initialDate.current);
        return;
      }
      initialDate.current = { ...date, [field]: newValue } as DateParts;
    };

  const handleKeyDown =
    (field: keyof DateParts) => (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.metaKey || e.ctrlKey) return;

      if (
        !/^[0-9]$/.test(e.key) &&
        !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Delete", "Tab", "Backspace", "Enter"].includes(e.key)
      ) {
        e.preventDefault();
        return;
      }

      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const dir = e.key === "ArrowUp" ? 1 : -1;
        const next = { ...date };

        if (field === "day") {
          const lastDay = new Date(next.year, next.month, 0).getDate();
          const cand = next.day + dir;
          if (cand > lastDay) {
            next.day = 1;
            next.month += 1;
            if (next.month === 13) {
              next.month = 1;
              next.year += 1;
            }
          } else if (cand < 1) {
            next.month -= 1;
            if (next.month === 0) {
              next.month = 12;
              next.year -= 1;
            }
            next.day = new Date(next.year, next.month, 0).getDate();
          } else {
            next.day = cand;
          }
        } else if (field === "month") {
          next.month += dir;
          if (next.month === 13) {
            next.month = 1;
            next.year += 1;
          }
          if (next.month === 0) {
            next.month = 12;
            next.year -= 1;
          }
          const lastDay = new Date(next.year, next.month, 0).getDate();
          next.day = Math.min(next.day, lastDay);
        } else if (field === "year") {
          next.year += dir;
          const lastDay = new Date(next.year, next.month, 0).getDate();
          next.day = Math.min(next.day, lastDay);
        }

        setDate(next);
        onChange(new Date(next.year, next.month - 1, next.day));
      }

      // Arrow navigation between fields (DD/MM/YYYY order)
      if (e.key === "ArrowRight") {
        if (
          e.currentTarget.selectionStart === e.currentTarget.value.length ||
          (e.currentTarget.selectionStart === 0 && e.currentTarget.selectionEnd === e.currentTarget.value.length)
        ) {
          e.preventDefault();
          if (field === "day") monthRef.current?.focus();
          if (field === "month") yearRef.current?.focus();
        }
      } else if (e.key === "ArrowLeft") {
        if (
          e.currentTarget.selectionStart === 0 ||
          (e.currentTarget.selectionStart === 0 && e.currentTarget.selectionEnd === e.currentTarget.value.length)
        ) {
          e.preventDefault();
          if (field === "month") dayRef.current?.focus();
          if (field === "year") monthRef.current?.focus();
        }
      }
    };

  const inputClass =
    "bg-transparent p-0 outline-none border-none text-center tabular-nums text-[11px] leading-none";

  return (
    <div className="sb-ring flex items-center rounded-md bg-white/70 px-1.5 py-1 dark:bg-white/5">
      <input
        ref={dayRef}
        type="text"
        inputMode="numeric"
        maxLength={2}
        value={String(date.day).padStart(2, "0")}
        onChange={handleInputChange("day")}
        onKeyDown={handleKeyDown("day")}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={handleBlur("day")}
        className={`${inputClass} w-5`}
        style={{ color: "var(--sb-text)" }}
        aria-label="Day"
      />
      <span className="text-[11px] opacity-30">/</span>
      <input
        ref={monthRef}
        type="text"
        inputMode="numeric"
        maxLength={2}
        value={String(date.month).padStart(2, "0")}
        onChange={handleInputChange("month")}
        onKeyDown={handleKeyDown("month")}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={handleBlur("month")}
        className={`${inputClass} w-5`}
        style={{ color: "var(--sb-text)" }}
        aria-label="Month"
      />
      <span className="text-[11px] opacity-30">/</span>
      <input
        ref={yearRef}
        type="text"
        inputMode="numeric"
        maxLength={4}
        value={String(date.year)}
        onChange={handleInputChange("year")}
        onKeyDown={handleKeyDown("year")}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={handleBlur("year")}
        className={`${inputClass} w-8`}
        style={{ color: "var(--sb-text)" }}
        aria-label="Year"
      />
    </div>
  );
}
