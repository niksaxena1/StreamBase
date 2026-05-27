"use client";

import Image from "next/image";
import type { KeyboardEvent, MouseEvent } from "react";

import { useImagePreview } from "@/components/ui/ImagePreviewProvider";

const FOCUS_RING =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sb-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sb-bg)]";

export function PreviewableArtwork({
  src,
  alt = "",
  width,
  height,
  className = "",
  objectPosition = "50% 50%",
  label,
  interactive = "button",
  disabled = false,
}: {
  src: string | null | undefined;
  alt?: string;
  width?: number;
  height?: number;
  className?: string;
  /** Passed to `object-position` for cover crops (competitor label thumbs). */
  objectPosition?: string;
  /** Accessible name for the preview control. */
  label?: string;
  /** Use `inline` inside other clickable rows (e.g. combobox options). */
  interactive?: "button" | "inline";
  disabled?: boolean;
}) {
  const { openPreview } = useImagePreview();

  if (!src) return null;

  const ariaLabel = label ?? (alt ? `View artwork for ${alt}` : "View artwork");

  const activate = (e: MouseEvent | KeyboardEvent) => {
    if (disabled) return;
    e.stopPropagation();
    e.preventDefault();
    openPreview(src);
  };

  const imgStyle = { objectPosition };

  const visual =
    width != null && height != null ? (
      <Image
        src={src}
        alt={alt}
        width={width}
        height={height}
        className={className}
        style={imgStyle}
      />
    ) : (
      // eslint-disable-next-line @next/next/no-img-element -- sized via className (tables, health lists)
      <img src={src} alt={alt} className={className} style={imgStyle} />
    );

  if (interactive === "inline") {
    return (
      <span
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={ariaLabel}
        className={[
          "inline-flex shrink-0 cursor-pointer transition-opacity hover:opacity-85",
          FOCUS_RING,
          disabled ? "pointer-events-none opacity-60" : "",
        ].join(" ")}
        onClick={activate}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") activate(e);
        }}
      >
        {visual}
      </span>
    );
  }

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      className={[
        "inline-flex shrink-0 border-0 bg-transparent p-0 cursor-pointer transition-opacity hover:opacity-85",
        FOCUS_RING,
        disabled ? "cursor-not-allowed opacity-60" : "",
      ].join(" ")}
      onClick={activate}
    >
      {visual}
    </button>
  );
}
