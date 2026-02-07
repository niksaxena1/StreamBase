"use client";

import { useCallback, useEffect, useRef } from "react";

export function useLongPress(opts: {
  enabled?: boolean;
  longPressMs?: number;
  moveThresholdPx?: number;
  onLongPress: () => void;
}) {
  const enabled = opts.enabled ?? true;
  const longPressMs = opts.longPressMs ?? 550;
  const moveThresholdPx = opts.moveThresholdPx ?? 10;
  const onLongPress = opts.onLongPress;

  const lastPointerTypeRef = useRef<string | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressStartRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      clearLongPressTimer();
    };
  }, [clearLongPressTimer]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      lastPointerTypeRef.current = e.pointerType ?? null;
      const pt = e.pointerType ?? null;
      if (!enabled) return;
      if (pt !== "touch" && pt !== "pen") return;

      clearLongPressTimer();
      longPressStartRef.current = { x: e.clientX, y: e.clientY };
      longPressTimerRef.current = window.setTimeout(() => {
        onLongPress();
      }, longPressMs);
    },
    [clearLongPressTimer, enabled, longPressMs, onLongPress],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const pt = e.pointerType ?? null;
      if (pt !== "touch" && pt !== "pen") return;
      const start = longPressStartRef.current;
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (Math.hypot(dx, dy) > moveThresholdPx) {
        clearLongPressTimer();
      }
    },
    [clearLongPressTimer, moveThresholdPx],
  );

  const onPointerUp = useCallback(() => {
    clearLongPressTimer();
  }, [clearLongPressTimer]);

  const onPointerCancel = useCallback(() => {
    clearLongPressTimer();
  }, [clearLongPressTimer]);

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, lastPointerTypeRef };
}

