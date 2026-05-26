"use client";

import { useLayoutEffect, useRef, useState } from "react";

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
  const ref = useRef<HTMLDivElement | null>(null);
  const [flipLeft, setFlipLeft] = useState(false);
  const [clampDx, setClampDx] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    let raf = 0;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      const width = rect.width;
      const { left: boundLeft, right: boundRight } = getHorizontalClipBounds(el, viewportPaddingPx);

      if (!flipLeft) {
        // Default: tooltip extends to the right from the anchor (left edge).
        if (rect.right > boundRight) {
          setFlipLeft(true);
          setClampDx(0);
          return;
        }
        if (rect.left < boundLeft) {
          setClampDx(boundLeft - rect.left);
          return;
        }
        setClampDx(0);
        return;
      }

      // Flipped: visual box is left of the anchor. rect.right ≈ anchor x.
      // Decide unflip from where the box *would* sit if not flipped (avoids flip/unflip jitter).
      const unflippedRight = rect.right + width;
      if (unflippedRight <= boundRight) {
        setFlipLeft(false);
        setClampDx(0);
        return;
      }

      if (rect.left < boundLeft) {
        setClampDx(boundLeft - rect.left);
        return;
      }

      setClampDx(0);
    };

    const schedule = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };

    const ro = new ResizeObserver(() => schedule());
    ro.observe(el);

    schedule();

    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [flipLeft, viewportPaddingPx, gapPx]);

  return (
    <div
      ref={ref}
      style={{
        display: "inline-block",
        transform: flipLeft
          ? `translateX(calc(-100% - ${gapPx}px)) translateX(${clampDx}px)`
          : `translateX(${clampDx}px)`,
        willChange: "transform",
      }}
    >
      {children}
    </div>
  );
}
