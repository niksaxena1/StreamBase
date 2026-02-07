"use client";

import { useEffect, useMemo, useRef, useState } from "react";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export type MenuSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export function MenuSelect({
  value,
  options,
  onChange,
  placeholder = "Select…",
  ariaLabel,
  disabled = false,
  className,
  buttonClassName,
  menuClassName,
  align = "left",
  matchTriggerWidth = true,
}: {
  value: string;
  options: MenuSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
  buttonClassName?: string;
  menuClassName?: string;
  align?: "left" | "right";
  matchTriggerWidth?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [menuWidth, setMenuWidth] = useState<number | undefined>();

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (isOpen && matchTriggerWidth && buttonRef.current) {
      setMenuWidth(buttonRef.current.offsetWidth);
    }
  }, [isOpen, matchTriggerWidth]);

  const selectedLabel = useMemo(() => {
    return options.find((o) => o.value === value)?.label ?? (value ? value : placeholder);
  }, [options, placeholder, value]);

  return (
    <div ref={rootRef} className={cx("relative", className)}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen((v) => !v)}
        className={cx(
          "flex items-center justify-between gap-2 rounded-[var(--sb-radius)] border px-2.5 py-1.5 text-[11px] font-medium transition",
          disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
          buttonClassName,
        )}
        style={{
          backgroundColor: "var(--sb-surface)",
          borderColor: "var(--sb-border-2)",
          color: "var(--sb-text)",
        }}
        onMouseEnter={(e) => {
          if (disabled) return;
          e.currentTarget.style.backgroundColor = isOpen ? "var(--sb-surface)" : "var(--sb-card)";
        }}
        onMouseLeave={(e) => {
          if (disabled) return;
          e.currentTarget.style.backgroundColor = "var(--sb-surface)";
        }}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
      >
        <span className="truncate">{selectedLabel}</span>
        <svg
          className={cx("h-3 w-3 shrink-0 transition-transform", isOpen && "rotate-180")}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          style={{ color: "var(--sb-muted)" }}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && !disabled && (
        <div
          className={cx(
            "absolute top-full z-50 mt-2 rounded-[var(--sb-radius)] border p-1 shadow-lg",
            align === "right" ? "right-0" : "left-0",
            menuClassName,
          )}
          style={{
            width: matchTriggerWidth ? menuWidth : undefined,
            backgroundColor: "var(--sb-card)",
            borderColor: "var(--sb-border-2)",
            backdropFilter: "blur(var(--sb-blur))",
            WebkitBackdropFilter: "blur(var(--sb-blur))",
          }}
          role="listbox"
          aria-label={ariaLabel}
        >
          {options.map((opt) => {
            const isSelected = opt.value === value;
            const isDisabled = Boolean(opt.disabled);
            return (
              <button
                key={opt.value}
                type="button"
                disabled={isDisabled}
                onClick={() => {
                  if (isDisabled) return;
                  onChange(opt.value);
                  setIsOpen(false);
                }}
                className={cx(
                  "flex w-full items-center justify-between gap-2 rounded-[calc(var(--sb-radius)-8px)] px-2 py-1.5 text-left text-xs transition",
                  isDisabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
                )}
                style={{
                  color: isSelected ? "#000" : "var(--sb-text)",
                  backgroundColor: isSelected ? "var(--sb-accent)" : "transparent",
                }}
                onMouseEnter={(e) => {
                  if (isSelected || isDisabled) return;
                  e.currentTarget.style.backgroundColor = "var(--sb-surface)";
                }}
                onMouseLeave={(e) => {
                  if (isSelected || isDisabled) return;
                  e.currentTarget.style.backgroundColor = "transparent";
                }}
                role="option"
                aria-selected={isSelected}
              >
                <span className="truncate">{opt.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
