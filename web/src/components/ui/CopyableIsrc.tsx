"use client";

import type { KeyboardEvent, MouseEvent } from "react";
import { showToast } from "@/lib/toast";

export type CopyableIsrcProps = {
  isrc: string | null | undefined;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
  /**
   * Renders a focusable span instead of a button — use when nested inside another
   * button or clickable row to avoid invalid HTML nesting.
   */
  inline?: boolean;
};

async function copyToClipboard(value: string): Promise<boolean> {
  const text = String(value ?? "").trim();
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function CopyableIsrc({ isrc, className, style, title, inline }: CopyableIsrcProps) {
  const normalized = String(isrc ?? "").trim();
  if (!normalized) return null;

  const baseClass = [
    "cursor-pointer select-none border-0 bg-transparent p-0 font-inherit text-left",
    "hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sb-accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--sb-bg)] rounded-sm",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const label = title ?? "Click to copy ISRC";

  const activate = async (e: MouseEvent | KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const ok = await copyToClipboard(normalized);
    if (ok) showToast("ISRC copied to clipboard", "success");
    else showToast("Could not copy ISRC", "error");
  };

  if (inline) {
    return (
      <span
        role="button"
        tabIndex={0}
        className={baseClass}
        style={style}
        title={label}
        onClick={activate}
        onKeyDown={(e: KeyboardEvent<HTMLSpanElement>) => {
          if (e.key === "Enter" || e.key === " ") void activate(e);
        }}
      >
        {normalized}
      </span>
    );
  }

  return (
    <button type="button" className={baseClass} style={style} title={label} onClick={activate}>
      {normalized}
    </button>
  );
}
