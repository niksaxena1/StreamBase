"use client";

import { useLayoutEffect, type RefObject } from "react";

/** Fill the viewport from the actual table edge, including toolbar wraps and bulk selection. */
export function useLibraryViewportHeight(scrollRef: RefObject<HTMLDivElement | null>, toolbarRef: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    let frame = 0;
    function measure() {
      if (!container) return;
      container.style.height = `${Math.max(360, window.innerHeight - container.getBoundingClientRect().top - 16)}px`;
    }
    function queueMeasure() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    }
    measure();
    const observer = new ResizeObserver(queueMeasure);
    if (toolbarRef.current) observer.observe(toolbarRef.current);
    window.addEventListener("resize", queueMeasure);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", queueMeasure);
    };
  }, [scrollRef, toolbarRef]);
}
