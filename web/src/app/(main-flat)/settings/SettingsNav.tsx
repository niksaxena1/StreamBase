"use client";

import { useEffect, useState } from "react";

interface Section {
  id: string;
  label: string;
}

export function SettingsNav({ sections }: { sections: Section[] }) {
  const [activeId, setActiveId] = useState(sections[0]?.id ?? "");

  useEffect(() => {
    const ids = sections.map((s) => s.id);
    const els = ids
      .map((id) => document.getElementById(id))
      .filter(Boolean) as HTMLElement[];

    if (!els.length) return;

    const visible = new Set<string>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        for (const id of ids) {
          if (visible.has(id)) {
            setActiveId(id);
            return;
          }
        }
      },
      { rootMargin: "-60px 0px -50% 0px", threshold: 0 },
    );

    for (const el of els) observer.observe(el);
    return () => observer.disconnect();
  }, [sections]);

  return (
    <nav
      className="sticky top-0 z-20 -mx-3 flex flex-wrap gap-1.5 rounded-2xl border px-4 py-2 backdrop-blur-md"
      style={{
        background:
          "linear-gradient(to bottom, color-mix(in srgb, var(--sb-bg) 70%, transparent), color-mix(in srgb, var(--sb-bg) 24%, transparent) 65%, transparent)",
        borderColor: "var(--sb-border)",
      }}
    >
      {sections.map((s) => {
        const isActive = s.id === activeId;
        return (
          <a
            key={s.id}
            href={`#${s.id}`}
            className={[
              "sb-ring inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium transition",
              isActive
                ? "bg-black text-white shadow-sm dark:bg-white dark:text-black"
                : "bg-white/70 hover:bg-white dark:bg-white/10 dark:hover:bg-white/20",
            ].join(" ")}
            style={isActive ? undefined : { color: "var(--sb-text)" }}
          >
            {s.label}
          </a>
        );
      })}
    </nav>
  );
}
