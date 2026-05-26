"use client";

import { useEffect, useState } from "react";

import { competitorAccentCssVars } from "@/lib/competitorAccent";
import { COMPETITOR_ACCENT_EVENT, type CompetitorAccentEventDetail } from "@/lib/competitorAccentEvents";

export function CompetitorAccentStyle({ accentHex }: { accentHex: string | null }) {
  const [hex, setHex] = useState(accentHex);

  useEffect(() => {
    setHex(accentHex);
  }, [accentHex]);

  useEffect(() => {
    function onAccent(e: Event) {
      const detail = (e as CustomEvent<CompetitorAccentEventDetail>).detail;
      setHex(detail?.accentHex ?? null);
    }
    window.addEventListener(COMPETITOR_ACCENT_EVENT, onAccent);
    return () => window.removeEventListener(COMPETITOR_ACCENT_EVENT, onAccent);
  }, []);

  const vars = hex ? competitorAccentCssVars(hex) : "";
  if (!vars) return null;
  return <style>{`:root,html,html[data-theme="dark"]{${vars}}`}</style>;
}
