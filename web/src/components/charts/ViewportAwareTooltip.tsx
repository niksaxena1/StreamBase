"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";

/** Extra room required before unflipping (prevents flip/unflip oscillation at clip edges). */
const FLIP_HYSTERESIS_PX = 24;

function overflowsAxis(value: string): boolean {
  return value === "hidden" || value === "auto" || value === "scroll" || value === "clip";
}

/** Tightest horizontal clip region from viewport + overflow ancestors (e.g. modals). */
function getHorizontalClipBounds(anchor: HTMLElement, paddingPx: number): { left: number; right: number } {
  const vw = window.innerWidth || document.documentElement.clientWidth || 0;
  let left = paddingPx;
  let right = vw > 0 ? vw - paddingPx : paddingPx;

  let node: HTMLElement | null = anchor.parentElement;
  while (node && node !== document.documentElement) {
    const style = getComputedStyle(node);
    if (overflowsAxis(style.overflowX) || overflowsAxis(style.overflowY)) {
      const rect = node.getBoundingClientRect();
      left = Math.max(left, rect.left + paddingPx);
      right = Math.min(right, rect.right - paddingPx);
    }
    node = node.parentElement;
  }

  if (right < left) {
    const mid = (left + right) / 2;
    return { left: mid, right: mid };
  }

  return { left, right };
}

export function ViewportAwareTooltip({
  children,
  viewportPaddingPx = 8,
  gapPx = 12,
}: {
  children: React.ReactNode;
  /** Minimum padding to keep from viewport edge */
  viewportPaddingPx?: number;
  /** Distance between anchor and tooltip when flipped */
  gapPx?: number;
}) {
  /** Recharts positions this outer wrapper; keep it untransformed for stable measurements. */
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const flipLeftRef = useRef(false);
  const clampDxRef = useRef(0);
  const [flipLeft, setFlipLeft] = useState(false);
  const [clampDx, setClampDx] = useState(0);

  const measurePlacement = useCallback(() => {
    const anchor = anchorRef.current;
    const content = contentRef.current;
    if (!anchor || !content) return;

    const width = content.offsetWidth;
    if (width <= 0) return;

    const { left: boundLeft, right: boundRight } = getHorizontalClipBounds(anchor, viewportPaddingPx);
    const anchorX = anchor.getBoundingClientRect().left;
    const flipped = flipLeftRef.current;

    const rightEdgeIfUnflipped = anchorX + width;
    const leftEdgeIfFlipped = anchorX - width - gapPx;

    let nextFlip = flipped;
    let nextClamp = 0;

    if (!flipped) {
      if (rightEdgeIfUnflipped > boundRight) {
        nextFlip = true;
        nextClamp = leftEdgeIfFlipped < boundLeft ? boundLeft - leftEdgeIfFlipped : 0;
      } else {
        nextClamp = anchorX < boundLeft ? boundLeft - anchorX : 0;
      }
    } else if (rightEdgeIfUnflipped <= boundRight - FLIP_HYSTERESIS_PX) {
      nextFlip = false;
      nextClamp = anchorX < boundLeft ? boundLeft - anchorX : 0;
    } else {
      nextClamp = leftEdgeIfFlipped < boundLeft ? boundLeft - leftEdgeIfFlipped : 0;
    }

    if (nextFlip !== flipLeftRef.current) {
      flipLeftRef.current = nextFlip;
      setFlipLeft(nextFlip);
    }
    if (nextClamp !== clampDxRef.current) {
      clampDxRef.current = nextClamp;
      setClampDx(nextClamp);
    }
  }, [gapPx, viewportPaddingPx]);

  // Re-measure after flip/clamp transform is applied to the inner content.
  useLayoutEffect(() => {
    measurePlacement();
  }, [flipLeft, clampDx, measurePlacement]);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    let raf = 0;

    const schedule = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measurePlacement);
    };

    const ro = new ResizeObserver(() => schedule());
    ro.observe(content);

    schedule();

    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [measurePlacement]);

  return (
    <div ref={anchorRef} style={{ display: "inline-block" }}>
      <div
        ref={contentRef}
        style={{
          transform: flipLeft
            ? `translateX(calc(-100% - ${gapPx}px)) translateX(${clampDx}px)`
            : `translateX(${clampDx}px)`,
          willChange: "transform",
        }}
      >
        {children}
      </div>
    </div>
  );
}
