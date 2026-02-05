"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type MenuSelectOption<T extends string> = {
  value: T;
  label: string;
};

export function MenuSelect<T extends string>(props: {
  value: T;
  options: Array<MenuSelectOption<T>>;
  onChange: (v: T) => void;
  className?: string;
  align?: "left" | "right";
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [buttonWidth, setButtonWidth] = useState<number | undefined>();

  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      const el = containerRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, []);

  useEffect(() => {
    function onKeyDown(ev: KeyboardEvent) {
      if (ev.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (open && buttonRef.current) setButtonWidth(buttonRef.current.offsetWidth);
  }, [open]);

  const selectedLabel = useMemo(
    () => props.options.find((o) => o.value === props.value)?.label ?? "",
    [props.options, props.value],
  );

  const sideClass =
    props.align === "left" ? "left-0" : "right-0";

  return (
    <div className="relative" ref={containerRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={[
          "flex items-center gap-2 whitespace-nowrap rounded-xl border px-3 py-2 text-sm font-medium transition",
          props.className,
        ]
          .filter(Boolean)
          .join(" ")}
        style={{
          backgroundColor: "var(--sb-surface)",
          borderColor: "var(--sb-border-2)",
          color: "var(--sb-text)",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = open ? "var(--sb-surface)" : "var(--sb-card)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "var(--sb-surface)";
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={props.ariaLabel}
      >
        <span>{selectedLabel}</span>
        <svg
          className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          style={{ color: "var(--sb-muted)" }}
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open ? (
        <div
          className={`absolute ${sideClass} top-full z-50 mt-2 rounded-[var(--sb-radius)] border p-1 shadow-lg`}
          style={{
            width: buttonWidth,
            backgroundColor: "var(--sb-card)",
            borderColor: "var(--sb-border-2)",
            backdropFilter: "blur(var(--sb-blur))",
            WebkitBackdropFilter: "blur(var(--sb-blur))",
          }}
          role="listbox"
        >
          {props.options.map((o) => {
            const selected = o.value === props.value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  props.onChange(o.value);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between gap-2 whitespace-nowrap rounded-[calc(var(--sb-radius)-8px)] px-2 py-1.5 text-left text-xs transition"
                style={{
                  color: selected ? "#000" : "var(--sb-text)",
                  backgroundColor: selected ? "var(--sb-accent)" : "transparent",
                }}
                onMouseEnter={(e) => {
                  if (!selected) e.currentTarget.style.backgroundColor = "var(--sb-surface)";
                }}
                onMouseLeave={(e) => {
                  if (!selected) e.currentTarget.style.backgroundColor = "transparent";
                }}
                role="option"
                aria-selected={selected}
              >
                <span>{o.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

