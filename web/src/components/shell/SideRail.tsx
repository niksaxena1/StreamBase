"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React from "react";

export type Item = {
  href: string;
  label: string;
  icon: (active: boolean) => React.ReactElement;
};

export const navItems: Item[] = [
  {
    href: "/dashboard/playlists",
    label: "Playlist Dash",
    icon: (a) => <IconList active={a} />,
  },
  {
    href: "/dashboard/artists",
    label: "Artist Dash",
    icon: (a) => <IconUser active={a} />,
  },
  { href: "/tracks", label: "Tracks", icon: (a) => <IconMusic active={a} /> },
  {
    href: "/playlists",
    label: "Playlists",
    icon: (a) => <IconList active={a} />,
  },
  { href: "/health", label: "Health", icon: (a) => <IconPulse active={a} /> },
];

export function SideRail() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-[60px] shrink-0 sm:block">
      <div className="sb-glass sticky top-3 flex flex-col items-center gap-2 px-2 py-2">
        {navItems.map((it) => {
          const active = pathname === it.href || pathname.startsWith(`${it.href}/`);
          return (
            <Link
              key={it.href}
              href={it.href}
              title={it.label}
              className={[
                "grid h-9 w-9 place-items-center rounded-full transition",
                active
                  ? "bg-black text-white shadow-sm"
                  : "bg-white/70 text-black/70 hover:bg-white",
              ].join(" ")}
            >
              {it.icon(active)}
            </Link>
          );
        })}

        <div className="my-2 h-px w-full" style={{ background: "var(--sb-border)" }} />

        <div
          className="grid h-9 w-9 place-items-center rounded-full"
          style={{
            background: "color-mix(in srgb, var(--sb-accent) 55%, white)",
            boxShadow: "var(--sb-shadow-compact)",
          }}
          title="Accent"
        >
          <span className="text-xs font-semibold text-black/80">SB</span>
        </div>
      </div>
    </aside>
  );
}

export function IconGrid(props: { active: boolean }) {
  const iconClass = props.active ? "text-white" : "text-black/70";
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className={iconClass}>
      <path
        d="M4 5.5C4 4.67157 4.67157 4 5.5 4H10.5C11.3284 4 12 4.67157 12 5.5V10.5C12 11.3284 11.3284 12 10.5 12H5.5C4.67157 12 4 11.3284 4 10.5V5.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M12 13.5C12 12.6716 12.6716 12 13.5 12H18.5C19.3284 12 20 12.6716 20 13.5V18.5C20 19.3284 19.3284 20 18.5 20H13.5C12.6716 20 12 19.3284 12 18.5V13.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M12 5.5C12 4.67157 12.6716 4 13.5 4H18.5C19.3284 4 20 4.67157 20 5.5V10.5C20 11.3284 19.3284 12 18.5 12H13.5C12.6716 12 12 11.3284 12 10.5V5.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        opacity="0.7"
      />
      <path
        d="M4 13.5C4 12.6716 4.67157 12 5.5 12H10.5C11.3284 12 12 12.6716 12 13.5V18.5C12 19.3284 11.3284 20 10.5 20H5.5C4.67157 20 4 19.3284 4 18.5V13.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        opacity="0.7"
      />
    </svg>
  );
}

export function IconUser(props: { active: boolean }) {
  const iconClass = props.active ? "text-white" : "text-black/70";
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className={iconClass}>
      <path
        d="M20 21C20 17.6863 16.4183 15 12 15C7.58172 15 4 17.6863 4 21"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M12 12C14.2091 12 16 10.2091 16 8C16 5.79086 14.2091 4 12 4C9.79086 4 8 5.79086 8 8C8 10.2091 9.79086 12 12 12Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
    </svg>
  );
}

export function IconList(props: { active: boolean }) {
  const iconClass = props.active ? "text-white" : "text-black/70";
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className={iconClass}>
      <path d="M7 7H20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path
        d="M7 12H20"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        opacity="0.75"
      />
      <path
        d="M7 17H20"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        opacity="0.55"
      />
      <path
        d="M4 7H4.01"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M4 12H4.01"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.75"
      />
      <path
        d="M4 17H4.01"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.55"
      />
    </svg>
  );
}

export function IconPulse(props: { active: boolean }) {
  const iconClass = props.active ? "text-white" : "text-black/70";
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className={iconClass}>
      <path
        d="M4 13.5H8L10 6L14 18L16 13.5H20"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function IconMusic(props: { active: boolean }) {
  const iconClass = props.active ? "text-white" : "text-black/70";
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className={iconClass}>
      <path
        d="M14 5V15.2C14 16.7464 12.6569 18 11 18C9.34315 18 8 16.7464 8 15.2C8 13.6536 9.34315 12.4 11 12.4C11.7403 12.4 12.4176 12.6506 12.94 13.065V6.2L20 5V12.8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
