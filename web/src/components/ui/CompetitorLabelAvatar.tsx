"use client";

import { competitorLabelThumbObjectPosition } from "@/lib/competitorLabelThumbFit";
import { cx } from "@/lib/cx";

const ACCENT_RING_PX = 1.5;

const SIZE_CLASS = {
  /** Competitor menu rows */
  xs: "h-[18px] w-[18px]",
  /** Header IconButton sm — same 2rem box as History / metric / user menu */
  sm: "h-8 w-8",
  md: "h-10 w-10",
} as const;

export type CompetitorLabelAvatarSize = keyof typeof SIZE_CLASS;

/** Gap between artwork edge and accent ring (matches sb-focus double-shadow pattern). */
const RING_GAP_PX: Record<CompetitorLabelAvatarSize, number> = {
  xs: 1,
  sm: 1.5,
  md: 2,
};

function normalizeRingHex(hex: string | null | undefined): string | null {
  if (!hex) return null;
  const clean = hex.replace(/^#/, "").toLowerCase();
  return /^[0-9a-f]{6}$/.test(clean) ? clean : null;
}

/** Concentric gap + ring: bg halo on top, accent spread behind (see `.sb-focus` in globals.css). */
function accentRingBoxShadow(ringHex: string, gapPx: number): string {
  const outerSpread = gapPx + ACCENT_RING_PX;
  return `0 0 0 ${gapPx}px var(--sb-bg), 0 0 0 ${outerSpread}px #${ringHex}`;
}

/**
 * Square Spotify cover → circle (equal w/h + rounded-full + object-cover).
 * Gap and accent ring are drawn as stacked box-shadows on the same circle so they stay concentric.
 */
export function CompetitorLabelAvatar({
  src,
  labelKey,
  size = "sm",
  ringHex,
  variant = "image",
  className,
}: {
  src?: string | null;
  labelKey?: string | null;
  size?: CompetitorLabelAvatarSize;
  ringHex?: string | null;
  variant?: "image" | "all" | "placeholder";
  className?: string;
}) {
  const ring = normalizeRingHex(ringHex);
  const ringStyle = ring ? { boxShadow: accentRingBoxShadow(ring, RING_GAP_PX[size]) } : undefined;

  return (
    <span
      className={cx(
        "relative block shrink-0 overflow-hidden rounded-full",
        SIZE_CLASS[size],
        !ringStyle && "sb-ring",
        className,
      )}
      style={ringStyle}
    >
      {variant === "all" ? (
        <span className="grid size-full place-items-center bg-[var(--sb-accent-10)] text-[9px] font-semibold leading-none text-[var(--sb-accent-text,inherit)]">
          All
        </span>
      ) : variant === "placeholder" || !src ? (
        <span className="block size-full bg-fuchsia-500/15" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          className="block size-full object-cover"
          style={{ objectPosition: competitorLabelThumbObjectPosition(labelKey) }}
          draggable={false}
        />
      )}
    </span>
  );
}
