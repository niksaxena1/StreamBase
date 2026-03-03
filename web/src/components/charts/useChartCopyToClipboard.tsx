"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent, PointerEvent } from "react";

import { Modal } from "@/components/ui/Modal";
import { formatTooltipDateSmart, showCopiedToast } from "./chartUtils";

export type TooltipCopyValues = {
  label: string | null;
  main: string;
  ma7: string | null;
};

export function useChartCopyToClipboard(args: { valueLabel: string }) {
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [copySnapshot, setCopySnapshot] = useState<TooltipCopyValues | null>(null);
  const lastTooltipValuesRef = useRef<TooltipCopyValues | null>(null);
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

  const setTooltipValues = useCallback((v: TooltipCopyValues) => {
    lastTooltipValuesRef.current = v;
  }, []);

  const openCopyDialogIfPossible = useCallback(() => {
    const v = lastTooltipValuesRef.current;
    if (!v) return;
    setCopySnapshot(v);
    setCopyDialogOpen(true);
  }, []);

  const handleCopyValue = useCallback(async (toCopy: string | null, message: string) => {
    if (!toCopy) return;
    try {
      await navigator.clipboard.writeText(toCopy);
      showCopiedToast(message);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  }, []);

  const dialogTitle = useMemo(() => {
    if (!copySnapshot?.label) return "Copy value";
    return formatTooltipDateSmart(copySnapshot.label);
  }, [copySnapshot]);

  const hasMaInSnapshot = !!copySnapshot?.ma7;

  const containerProps = {
    onMouseDown: (e: MouseEvent) => {
      // Prevent focus outline box on click (the chart isn't keyboard-focusable anyway).
      e.preventDefault();
    },
    onPointerDown: (e: PointerEvent) => {
      lastPointerTypeRef.current = e.pointerType ?? null;
      const pt = e.pointerType ?? null;
      if (pt !== "touch" && pt !== "pen") return;

      clearLongPressTimer();
      longPressStartRef.current = { x: e.clientX, y: e.clientY };
      longPressTimerRef.current = window.setTimeout(() => {
        const v = lastTooltipValuesRef.current;
        if (!v) return;
        if (v.ma7) {
          openCopyDialogIfPossible();
          return;
        }
        void handleCopyValue(v.main, "Copied to clipboard!");
      }, 550);
    },
    onPointerMove: (e: PointerEvent) => {
      const pt = e.pointerType ?? null;
      if (pt !== "touch" && pt !== "pen") return;
      const start = longPressStartRef.current;
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (Math.hypot(dx, dy) > 10) {
        clearLongPressTimer();
      }
    },
    onPointerUp: () => {
      clearLongPressTimer();
    },
    onPointerCancel: () => {
      clearLongPressTimer();
    },
    onClick: async (e: MouseEvent) => {
      // Touch/pen: taps do nothing (copy is via long-press dialog).
      if (lastPointerTypeRef.current === "touch" || lastPointerTypeRef.current === "pen") return;
      const v = lastTooltipValuesRef.current;
      if (!v) return;
      const wantMA = (e.ctrlKey || e.metaKey) && !!v.ma7;
      const toCopy = wantMA ? v.ma7 : v.main;
      await handleCopyValue(toCopy, wantMA ? "Copied MA to clipboard!" : "Copied to clipboard!");
    },
  } as const;

  const copyModal = (
    <Modal
      open={copyDialogOpen}
      onClose={() => setCopyDialogOpen(false)}
      title={dialogTitle}
      subtitle={hasMaInSnapshot ? "Choose which value to copy" : "Tap Copy to copy to clipboard"}
      maxWidthClassName="max-w-md"
    >
      <div className="space-y-2">
        <button
          type="button"
          className="w-full sb-ring rounded-md bg-white/60 px-3 py-2 text-left text-sm hover:bg-white/80 dark:bg-white/10 dark:hover:bg-white/15"
          style={{ color: "var(--sb-text)" }}
          onClick={async () => {
            await handleCopyValue(copySnapshot?.main ?? null, "Copied to clipboard!");
            setCopyDialogOpen(false);
          }}
        >
          <div className="text-xs opacity-70">{args.valueLabel}</div>
          <div className="font-semibold">{copySnapshot?.main ?? ""}</div>
        </button>

        {copySnapshot?.ma7 ? (
          <button
            type="button"
            className="w-full sb-ring rounded-md bg-white/60 px-3 py-2 text-left text-sm hover:bg-white/80 dark:bg-white/10 dark:hover:bg-white/15"
            style={{ color: "var(--sb-text)" }}
            onClick={async () => {
              await handleCopyValue(copySnapshot?.ma7 ?? null, "Copied MA to clipboard!");
              setCopyDialogOpen(false);
            }}
          >
            <div className="text-xs opacity-70">MA (7d)</div>
            <div className="font-semibold">{copySnapshot?.ma7 ?? ""}</div>
          </button>
        ) : null}
      </div>
    </Modal>
  );

  return { containerProps, setTooltipValues, copyModal } as const;
}

