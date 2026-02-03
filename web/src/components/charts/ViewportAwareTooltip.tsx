"use client";

import { useLayoutEffect, useRef, useState } from "react";

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
      // Reset clamp first; we'll recompute below.
      setClampDx(0);

      const rect = el.getBoundingClientRect();
      const vw = window.innerWidth || document.documentElement.clientWidth || 0;
      if (!vw) return;

      // If the tooltip is flowing off the right edge, flip it to the left of the anchor.
      if (!flipLeft && rect.right > vw - viewportPaddingPx) {
        setFlipLeft(true);
        return;
      }

      // If flipped, ensure we don't flow off the left edge.
      if (flipLeft && rect.left < viewportPaddingPx) {
        setClampDx(viewportPaddingPx - rect.left);
      }
    };

    const schedule = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };

    const ro = new ResizeObserver(() => schedule());
    ro.observe(el);

    // Initial measurement.
    schedule();

    // Re-measure on viewport changes / scroll (covers charts inside scroll containers).
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [flipLeft, viewportPaddingPx]);

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

