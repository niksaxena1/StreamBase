"use client";

import { useEffect, useLayoutEffect, useId, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/Button";

/** Library toolbar dropdown, sharing dismissal/focus behavior between facets and attention. */
export function LibraryToolbarPopover({
  label, trigger, children, warning = false,
}: {
  label: string;
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  warning?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const panel = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    function position() {
      if (!root.current || !button.current || !panel.current) return;
      const anchor = button.current.getBoundingClientRect();
      const width = panel.current.getBoundingClientRect().width;
      const left = Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8));
      panel.current.style.left = `${left - root.current.getBoundingClientRect().left}px`;
      panel.current.style.right = "auto";
    }
    position();
    window.addEventListener("resize", position);
    return () => window.removeEventListener("resize", position);
  }, [open]);

  useEffect(() => {
    if (!open) {
      if (wasOpen.current && document.activeElement === document.body) button.current?.focus();
      wasOpen.current = false;
      return;
    }
    wasOpen.current = true;
    panel.current?.querySelector<HTMLElement>("select, input, button")?.focus();
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      button.current?.focus();
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);

  function close() {
    setOpen(false);
  }

  return (
    <div ref={root} className="relative shrink-0" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <Button
        ref={button}
        variant="ghost"
        className="h-7 gap-1 px-2 text-[11px] whitespace-nowrap"
        style={warning ? { color: "var(--sb-warning)" } : undefined}
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        {trigger}
      </Button>
      {open ? (
        <div
          ref={panel}
          id={id}
          role="dialog"
          aria-label={label}
          className="absolute right-0 top-full z-30 mt-1 max-h-[65dvh] w-[min(24rem,calc(100vw-3rem))] overflow-auto rounded-xl border p-3 shadow-xl"
          style={{ background: "var(--sb-surface)", borderColor: "var(--sb-border)" }}
        >
          {children(close)}
        </div>
      ) : null}
    </div>
  );
}
