import { useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { prefersReducedMotion } from "../lib/animation";
import { formatUtcDate } from "../lib/format";
import { Artwork, Num } from "./ui";

/** True while the element is scrolled out of view above the (sticky) top bar. */
export function useScrolledPast(target: RefObject<HTMLElement | null>): boolean {
  const [past, setPast] = useState(false);
  useEffect(() => {
    const element = target.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const topbar = Number.parseInt(
      getComputedStyle(document.documentElement).getPropertyValue("--topbar-h"),
      10,
    );
    const observer = new IntersectionObserver(
      ([entry]) =>
        setPast(!entry.isIntersecting && entry.boundingClientRect.top < 0),
      { rootMargin: `-${Number.isFinite(topbar) ? topbar : 68}px 0px 0px 0px` },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [target]);
  return past;
}

/**
 * Slim bar under the top bar once the track header has scrolled away: cover, title, artist,
 * From → To and the difference. It lives in the shell's #sticky-slot so it never shifts the layout.
 */
export function StickyTrackBar({
  visible,
  cover,
  title,
  artist,
  from,
  to,
  difference,
}: {
  visible: boolean;
  cover?: string | null;
  title: string;
  artist: string;
  from: string;
  to: string;
  difference: number | null;
}) {
  const slot = document.getElementById("sticky-slot");
  if (!slot) return null;
  return createPortal(
    <div
      className={`sticky-track${visible ? " shown" : ""}`}
      aria-hidden={!visible}
      data-testid="sticky-track-bar"
    >
      <Artwork src={cover} name={title} size={28} preview={false} inline />
      <span className="sticky-title">
        <strong>{title}</strong>
        <span className="muted">{artist}</span>
      </span>
      <span className="sticky-dates mono">
        {formatUtcDate(from)} → {formatUtcDate(to)}
      </span>
      <span className="sticky-diff mono">
        {difference === null ? "—" : <Num value={difference} signed />}
        <small> streams</small>
      </span>
      <button
        type="button"
        className="sticky-top"
        tabIndex={visible ? 0 : -1}
        aria-label="Back to top of track"
        onClick={() => window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" })}
      >
        ↑
      </button>
    </div>,
    slot,
  );
}
