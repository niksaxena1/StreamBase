"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { NETWORK_LONG_PRESS_MS, NETWORK_LONG_PRESS_MOVE_PX } from "./networkGraphConstants";

/**
 * Catalog deep links from network: primary click/tap stays on the network (`onPrimaryAction`);
 * Ctrl/Cmd+click follows the link unless `onCtrlClick` is set; touch/pen long-press opens Catalog unless
 * `onLongPressOverride` is set (same timing as graph marquee).
 */
export function NetworkCatalogRoutedLink({
  href,
  onPrimaryAction,
  className,
  title: titleProp,
  onCtrlClick,
  onLongPressOverride,
  children,
}: {
  href: string;
  onPrimaryAction: () => void;
  className?: string;
  title?: string;
  /** When set, Ctrl/Cmd+click runs this instead of navigating to `href`. */
  onCtrlClick?: () => void;
  /** When set, touch/pen long-press runs this instead of `router.push(href)`. */
  onLongPressOverride?: () => void;
  children: ReactNode;
}) {
  const router = useRouter();
  const longPressTimerRef = useRef<number | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);
  const longPressPointerIdRef = useRef<number | null>(null);
  const skipNextClickRef = useRef(false);

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressStartRef.current = null;
    longPressPointerIdRef.current = null;
  }, []);

  useEffect(() => () => clearLongPress(), [clearLongPress]);

  const defaultTitle =
    "Click or tap: stay on network · Ctrl or ⌘+click: open in Catalog · Touch long-press: open Catalog";

  return (
    <Link
      href={href}
      className={className}
      title={titleProp ?? defaultTitle}
      onClick={(e) => {
        if (skipNextClickRef.current) {
          e.preventDefault();
          e.stopPropagation();
          skipNextClickRef.current = false;
          return;
        }
        if (e.ctrlKey || e.metaKey) {
          if (onCtrlClick) {
            e.preventDefault();
            e.stopPropagation();
            onCtrlClick();
          }
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        onPrimaryAction();
      }}
      onPointerDown={(e: ReactPointerEvent<HTMLAnchorElement>) => {
        if (e.button !== 0) return;
        const pt = e.pointerType;
        if (pt !== "touch" && pt !== "pen") return;
        clearLongPress();
        longPressStartRef.current = { x: e.clientX, y: e.clientY };
        longPressPointerIdRef.current = e.pointerId;
        longPressTimerRef.current = window.setTimeout(() => {
          longPressTimerRef.current = null;
          longPressStartRef.current = null;
          longPressPointerIdRef.current = null;
          skipNextClickRef.current = true;
          try {
            void navigator.vibrate?.(25);
          } catch {
            // ignore
          }
          if (onLongPressOverride) {
            onLongPressOverride();
          } else {
            router.push(href);
          }
        }, NETWORK_LONG_PRESS_MS);
      }}
      onPointerMove={(e: ReactPointerEvent<HTMLAnchorElement>) => {
        if (longPressTimerRef.current == null || e.pointerId !== longPressPointerIdRef.current) return;
        const start = longPressStartRef.current;
        if (!start) return;
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (Math.hypot(dx, dy) > NETWORK_LONG_PRESS_MOVE_PX) {
          clearLongPress();
        }
      }}
      onPointerUp={clearLongPress}
      onPointerCancel={clearLongPress}
    >
      {children}
    </Link>
  );
}

export function NetworkCatalogArtistLink({
  artistId,
  onNetworkSelectArtist,
  onDistroGesture,
  className,
  title,
  children,
}: {
  artistId: string;
  onNetworkSelectArtist?: (id: string) => void;
  /** Ctrl/Cmd+click and touch long-press call this instead of opening Catalog (e.g. distro modal). */
  onDistroGesture?: () => void;
  className?: string;
  title?: string;
  children: ReactNode;
}) {
  const href = `/catalog?artist_id=${encodeURIComponent(artistId)}`;
  return (
    <NetworkCatalogRoutedLink
      href={href}
      className={className}
      title={title}
      onPrimaryAction={() => onNetworkSelectArtist?.(artistId)}
      onCtrlClick={onDistroGesture}
      onLongPressOverride={onDistroGesture}
    >
      {children}
    </NetworkCatalogRoutedLink>
  );
}
