"use client";

import Image from "next/image";
import { PreviewableArtwork } from "@/components/ui/PreviewableArtwork";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Check, Swords } from "lucide-react";

import { LogoMark } from "@/components/LogoMark";
import { ALL_COMPETITORS_KEY, isAllCompetitorsKey } from "@/lib/competitorContext";
import { competitorAccentCssVars } from "@/lib/competitorAccent";

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

function triggerRingStyle(
  datasetMode: "own" | "competitor",
  accentHex: string | null,
  ownHover: boolean,
): CSSProperties | undefined {
  if (datasetMode === "competitor" && accentHex) {
    return { boxShadow: `inset 0 0 0 1.5px #${accentHex}` };
  }
  if (datasetMode === "own") {
    return { boxShadow: ownHover ? undefined : "inset 0 0 0 1px var(--sb-border)" };
  }
  return undefined;
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
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ownHover, setOwnHover] = useState(false);
  const [previewHex, setPreviewHex] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuItemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [portalPos, setPortalPos] = useState<{ top: number; right: number } | null>(null);

  const activeLabel =
    datasetMode === "competitor" && activeLabelKey && !isAllCompetitorsKey(activeLabelKey)
      ? labels.find((l) => l.label_key === activeLabelKey) ?? null
      : null;

  const accentHex = activeLabel?.accent_hex ?? null;
  const showAllPill = datasetMode === "competitor" && isAllActive(datasetMode, activeLabelKey);
  const showCountBadge = datasetMode === "own" && labels.length > 0;

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
    setSaving(true);
    clearPreview();
    try {
      if (mode === "own") {
        const res = await fetch("/api/user-settings/dataset-mode", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dataset_mode: "own" }),
        });
        if (!res.ok) return;
      } else {
        const modeRes = await fetch("/api/user-settings/dataset-mode", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dataset_mode: "competitor" }),
        });
        if (!modeRes.ok) return;
        const labelRes = await fetch("/api/user-settings/competitor-label", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            competitor_label_key: labelKey ?? ALL_COMPETITORS_KEY,
          }),
        });
        if (!labelRes.ok) return;
      }
      window.location.reload();
    } finally {
      setSaving(false);
      setOpen(false);
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
    datasetMode === "own"
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
            const isActive = datasetMode === "competitor" && activeLabelKey === label.label_key;
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
                {label.image_url ? (
                  <PreviewableArtwork
                    src={label.image_url}
                    alt={label.display_name}
                    width={18}
                    height={18}
                    interactive="inline"
                    className="h-[18px] w-[18px] shrink-0 rounded object-cover sb-ring"
                  />
                ) : (
                  <span className="block h-[18px] w-[18px] shrink-0 rounded bg-fuchsia-500/15 sb-ring" />
                )}
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
          "relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition",
          "hover:bg-black/5 dark:hover:bg-white/10",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sb-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sb-bg)]",
        )}
        style={triggerRingStyle(datasetMode, accentHex, ownHover)}
      >
        {datasetMode === "own" ? (
          <Swords
            className={cx("h-4 w-4 transition-opacity", ownHover ? "opacity-90" : "opacity-60")}
            style={{ color: "var(--sb-muted)" }}
          />
        ) : showAllPill ? (
          <span className="grid h-6 w-6 place-items-center rounded-full bg-[var(--sb-accent-10)] text-[10px] font-semibold text-[var(--sb-accent-text,inherit)]">
            All
          </span>
        ) : activeLabel?.image_url ? (
          <Image
            src={activeLabel.image_url}
            alt=""
            width={28}
            height={28}
            className="pointer-events-none h-7 w-7 rounded-full object-cover"
          />
        ) : (
          <span className="block h-6 w-6 rounded-full bg-fuchsia-500/15" />
        )}

        {showCountBadge ? (
          <span
            className="absolute -right-0.5 -top-0.5 z-[1] flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-0.5 text-[9px] font-bold leading-none"
            style={{
              background: "var(--sb-card)",
              color: "var(--sb-muted)",
              border: "1px solid var(--sb-border)",
            }}
            title={`${labels.length} tracked competitor${labels.length !== 1 ? "s" : ""}`}
          >
            {labels.length > 9 ? "9+" : labels.length}
          </span>
        ) : null}
      </button>

      {open && typeof document !== "undefined" ? createPortal(menuContent, document.body) : null}
    </div>
  );
}

