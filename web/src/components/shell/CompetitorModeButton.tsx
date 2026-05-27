"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Loader2, Swords } from "lucide-react";

import { LogoMark } from "@/components/LogoMark";
import {
  ALL_COMPETITORS_ACCENT_HEX,
  ALL_COMPETITORS_KEY,
  isAllCompetitorsKey,
} from "@/lib/competitorContext";
import { pathAfterDatasetModeSwitch } from "@/lib/datasetModeNavigation";
import { competitorAccentCssVars } from "@/lib/competitorAccent";
import {
  COMPETITOR_LABEL_EVENT,
  dispatchCompetitorLabelChange,
  type CompetitorAccentEventDetail,
} from "@/lib/competitorAccentEvents";
import {
  triggerRouteLoadingBarDone,
  triggerRouteLoadingBarStart,
} from "@/lib/navigation/loadingBar";
import { CompetitorLabelAvatar } from "@/components/ui/CompetitorLabelAvatar";

type Label = {
  label_key: string;
  display_name: string;
  image_url: string | null;
  accent_hex: string | null;
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function isAllActive(datasetMode: "own" | "competitor", activeLabelKey: string | null) {
  return datasetMode === "competitor" && (!activeLabelKey || isAllCompetitorsKey(activeLabelKey));
}

function normalizeAccentHex(hex: string | null | undefined): string | null {
  if (!hex) return null;
  const clean = hex.replace(/^#/, "").toLowerCase();
  return /^[0-9a-f]{6}$/.test(clean) ? clean : null;
}

function resolveTriggerRingHex(
  datasetMode: "own" | "competitor",
  showAllPill: boolean,
  accentHex: string | null,
  previewHex: string | null,
  menuOpen: boolean,
): string | null {
  if (datasetMode !== "competitor") return null;
  const hex =
    menuOpen && previewHex
      ? normalizeAccentHex(previewHex)
      : showAllPill
        ? ALL_COMPETITORS_ACCENT_HEX
        : normalizeAccentHex(accentHex);
  return hex ?? null;
}

export function CompetitorModeButton({
  datasetMode,
  labels,
  activeLabelKey,
}: {
  datasetMode: "own" | "competitor";
  labels: Label[];
  activeLabelKey: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ownHover, setOwnHover] = useState(false);
  const [previewHex, setPreviewHex] = useState<string | null>(null);
  const [labelOverride, setLabelOverride] = useState<string | null>(null);
  const [datasetModeOverride, setDatasetModeOverride] = useState<"own" | "competitor" | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuItemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [portalPos, setPortalPos] = useState<{ top: number; right: number } | null>(null);

  const effectiveLabelKey = labelOverride ?? activeLabelKey;
  const effectiveDatasetMode = datasetModeOverride ?? datasetMode;

  // When real props arrive (after router.refresh() rebuilds the layout), drop our optimistic
  // overrides and finish the loading bar. This is the success-path cleanup for switchTo().
  useEffect(() => {
    setLabelOverride(null);
    setDatasetModeOverride(null);
    setSaving(false);
    triggerRouteLoadingBarDone();
  }, [activeLabelKey, datasetMode]);

  useEffect(() => {
    function onLabelChange(e: Event) {
      const detail = (e as CustomEvent<CompetitorAccentEventDetail>).detail;
      if (detail?.labelKey != null) setLabelOverride(detail.labelKey);
    }
    window.addEventListener(COMPETITOR_LABEL_EVENT, onLabelChange);
    return () => window.removeEventListener(COMPETITOR_LABEL_EVENT, onLabelChange);
  }, []);

  const activeLabel =
    effectiveDatasetMode === "competitor" &&
    effectiveLabelKey &&
    !isAllCompetitorsKey(effectiveLabelKey)
      ? labels.find((l) => l.label_key === effectiveLabelKey) ?? null
      : null;

  const showAllPill =
    effectiveDatasetMode === "competitor" && isAllActive(effectiveDatasetMode, effectiveLabelKey);

  const accentHex = activeLabel?.accent_hex ?? null;
  const triggerRingHex = resolveTriggerRingHex(
    effectiveDatasetMode,
    showAllPill,
    accentHex,
    previewHex,
    open,
  );
  const showCompetitorAvatar = effectiveDatasetMode === "competitor";

  const clearPreview = useCallback(() => setPreviewHex(null), []);

  useEffect(() => {
    if (!open) {
      clearPreview();
    }
  }, [open, clearPreview]);

  useEffect(() => {
    if (!open) return;

    function onDocPointerDown(e: MouseEvent | TouchEvent) {
      const target = e.target as Node | null;
      if (target && wrapRef.current?.contains(target)) return;
      if (target && menuRef.current?.contains(target)) return;
      setOpen(false);
    }

    document.addEventListener("mousedown", onDocPointerDown, true);
    document.addEventListener("touchstart", onDocPointerDown, true);
    return () => {
      document.removeEventListener("mousedown", onDocPointerDown, true);
      document.removeEventListener("touchstart", onDocPointerDown, true);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;

    const updatePos = () => {
      const btn = buttonRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      setPortalPos({ top: Math.round(r.bottom + 8), right: Math.round(window.innerWidth - r.right) });
    };

    updatePos();
    window.addEventListener("resize", updatePos);
    window.addEventListener("scroll", updatePos, true);
    return () => {
      window.removeEventListener("resize", updatePos);
      window.removeEventListener("scroll", updatePos, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const items = menuItemRefs.current.filter(Boolean) as HTMLButtonElement[];
    if (!items.length) return;

    const activeIndex = items.findIndex((el) => el.getAttribute("aria-current") === "true");
    (activeIndex >= 0 ? items[activeIndex] : items[0])?.focus();
  }, [open, datasetMode, activeLabelKey, labels.length]);

  async function switchTo(mode: "own" | "competitor", labelKey?: string) {
    const targetLabelKey =
      mode === "competitor" ? labelKey ?? ALL_COMPETITORS_KEY : null;
    const targetIsSpecificCompetitor =
      mode === "competitor" && targetLabelKey != null && !isAllCompetitorsKey(targetLabelKey);
    const targetAccentHex = targetIsSpecificCompetitor
      ? labels.find((l) => l.label_key === targetLabelKey)?.accent_hex ?? null
      : null;

    // Remember the previous chrome accent so we can roll back on failure.
    const previousAccentHex = activeLabel?.accent_hex ?? null;
    const previousLabelKey = activeLabelKey;

    setSaving(true);
    clearPreview();
    setOpen(false);

    // Optimistic UI: flip the trigger + accent immediately. The CompetitorAccentStyle
    // listener picks up the dispatched event and re-themes the chrome on the spot.
    setDatasetModeOverride(mode);
    setLabelOverride(targetLabelKey);
    dispatchCompetitorLabelChange({ accentHex: targetAccentHex, labelKey: targetLabelKey });

    triggerRouteLoadingBarStart();

    let ok = false;
    try {
      const res = await fetch("/api/user-settings/dataset-context", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataset_mode: mode,
          ...(mode === "competitor" ? { competitor_label_key: targetLabelKey } : {}),
        }),
      });
      ok = res.ok;

      if (ok) {
        // Strip universe-scoped search params on routes where mode change invalidates them.
        const cleanUrl = pathAfterDatasetModeSwitch(
          window.location.pathname,
          window.location.search,
        );
        if (cleanUrl && cleanUrl !== window.location.pathname + window.location.search) {
          // router.replace re-runs server components for the new URL.
          router.replace(cleanUrl);
        } else {
          // Same URL — just re-fetch the RSC payload (no full document reload).
          router.refresh();
        }
        // The success-path cleanup (clearing saving + finishing the loading bar) runs
        // automatically in the useEffect on activeLabelKey/datasetMode prop change.
      }
    } catch {
      // Network failure: handled in finally below.
    } finally {
      if (!ok) {
        // Roll back the optimistic chrome update + unlock the UI.
        setSaving(false);
        setDatasetModeOverride(null);
        setLabelOverride(null);
        dispatchCompetitorLabelChange({
          accentHex: previousAccentHex,
          labelKey: previousLabelKey,
        });
        triggerRouteLoadingBarDone();
      }
    }
  }

  function registerMenuItem(index: number) {
    return (el: HTMLButtonElement | null) => {
      menuItemRefs.current[index] = el;
    };
  }

  function onMenuKeyDown(e: React.KeyboardEvent) {
    const items = menuItemRefs.current.filter(Boolean) as HTMLButtonElement[];
    if (!items.length) return;

    const current = items.findIndex((el) => el === document.activeElement);

    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = current < 0 ? 0 : (current + 1) % items.length;
      items[next]?.focus();
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      const next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
      items[next]?.focus();
      return;
    }

    if (e.key === "Home") {
      e.preventDefault();
      items[0]?.focus();
      return;
    }

    if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1]?.focus();
      return;
    }

    if (e.key === "Enter" || e.key === " ") {
      if (current >= 0 && document.activeElement === items[current]) {
        e.preventDefault();
        items[current]?.click();
      }
    }
  }

  const triggerAriaLabel =
    effectiveDatasetMode === "own"
      ? "Competitors"
      : activeLabel
        ? activeLabel.display_name
        : "All competitors";

  menuItemRefs.current = [];
  let menuIndex = 0;
  const ownItemIndex = menuIndex++;
  const allItemIndex = labels.length > 0 ? menuIndex++ : -1;

  const previewVars = previewHex ? competitorAccentCssVars(previewHex) : "";

  const menuContent = (
    <div
      ref={menuRef}
      className="sb-card fixed z-[120] w-56 max-w-[min(14rem,calc(100vw-1.5rem))] p-1"
      style={{ top: portalPos?.top ?? 0, right: portalPos?.right ?? 0 }}
      role="menu"
      onKeyDown={onMenuKeyDown}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseLeave={clearPreview}
    >
      <p
        className="px-2.5 pb-1 pt-1.5 text-[9px] font-semibold uppercase tracking-wider"
        style={{ color: "var(--sb-muted)" }}
      >
        Mode
      </p>
      <button
        ref={registerMenuItem(ownItemIndex)}
        type="button"
        role="menuitem"
        aria-current={datasetMode === "own" ? "true" : undefined}
        disabled={saving}
        onClick={() => switchTo("own")}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition hover:bg-black/5 dark:hover:bg-white/10"
      >
        <span className="grid h-[18px] w-[18px] shrink-0 place-items-center">
          <LogoMark size={18} />
        </span>
        <span className="min-w-0 flex-1 truncate">Own Catalog</span>
        {datasetMode === "own" ? <Check className="h-3.5 w-3.5 shrink-0 opacity-70" /> : null}
      </button>

      {labels.length > 0 ? (
        <>
          <div className="my-0.5 border-t" style={{ borderColor: "var(--sb-border)" }} />
          <p
            className="px-2.5 pb-1 pt-1 text-[9px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--sb-muted)" }}
          >
            Competitors
          </p>
          <button
            ref={allItemIndex >= 0 ? registerMenuItem(allItemIndex) : undefined}
            type="button"
            role="menuitem"
            aria-current={showAllPill ? "true" : undefined}
            disabled={saving}
            onClick={() => switchTo("competitor", ALL_COMPETITORS_KEY)}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition hover:bg-black/5 dark:hover:bg-white/10"
          >
            <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded bg-[var(--sb-accent-10)] text-[10px] font-semibold sb-ring text-[var(--sb-accent-text,inherit)]">
              All
            </span>
            <span className="min-w-0 flex-1 truncate">All competitors</span>
            {showAllPill ? <Check className="h-3.5 w-3.5 shrink-0 opacity-70" /> : null}
          </button>
          {labels.map((label) => {
            const itemIndex = menuIndex++;
            const isActive = datasetMode === "competitor" && effectiveLabelKey === label.label_key;
            return (
              <button
                key={label.label_key}
                ref={registerMenuItem(itemIndex)}
                type="button"
                role="menuitem"
                aria-current={isActive ? "true" : undefined}
                disabled={saving}
                onClick={() => switchTo("competitor", label.label_key)}
                onMouseEnter={() => {
                  if (label.accent_hex) setPreviewHex(label.accent_hex);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition hover:bg-black/5 dark:hover:bg-white/10"
              >
                <CompetitorLabelAvatar
                  size="xs"
                  src={label.image_url}
                  labelKey={label.label_key}
                  variant={label.image_url ? "image" : "placeholder"}
                />
                <span className="min-w-0 flex-1 truncate">{label.display_name}</span>
                {isActive ? <Check className="h-3.5 w-3.5 shrink-0 opacity-70" /> : null}
              </button>
            );
          })}
        </>
      ) : null}
    </div>
  );

  return (
    <div ref={wrapRef} className={cx("relative", saving && "pointer-events-none opacity-60")}>
      {previewVars && open ? <style>{`:root,html,html[data-theme="dark"]{${previewVars}}`}</style> : null}

      <button
        ref={buttonRef}
        type="button"
        aria-label={triggerAriaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        title={triggerAriaLabel}
        disabled={saving}
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => datasetMode === "own" && setOwnHover(true)}
        onMouseLeave={() => setOwnHover(false)}
        className={cx(
          "relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full p-0 transition",
          !showCompetitorAvatar && "sb-ring",
          "hover:bg-black/5 dark:hover:bg-white/10",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sb-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sb-bg)]",
        )}
      >
        {effectiveDatasetMode === "own" ? (
          <Swords
            className={cx("h-4 w-4 transition-opacity", ownHover ? "opacity-90" : "opacity-60")}
            style={{ color: "var(--sb-muted)" }}
          />
        ) : showAllPill ? (
          <CompetitorLabelAvatar size="sm" variant="all" ringHex={triggerRingHex} />
        ) : (
          <CompetitorLabelAvatar
            size="sm"
            src={activeLabel?.image_url}
            labelKey={activeLabel?.label_key}
            ringHex={triggerRingHex}
            variant={activeLabel?.image_url ? "image" : "placeholder"}
          />
        )}
      </button>

      {saving ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 grid place-items-center rounded-full bg-black/20 dark:bg-black/40"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin text-black/70 dark:text-white" />
        </span>
      ) : null}

      {open && typeof document !== "undefined" ? createPortal(menuContent, document.body) : null}
    </div>
  );
}

