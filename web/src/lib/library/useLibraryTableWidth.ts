"use client";

import { useLayoutEffect, useState, type RefObject } from "react";

/** Observe the scroll viewport itself, including resizes caused by the surrounding layout. */
export function useLibraryTableWidth(scrollRef: RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(() => setWidth(viewport.clientWidth));
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [scrollRef]);
  return width;
}
