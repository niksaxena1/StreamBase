"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React from "react";
import type { DatasetMode } from "@/lib/datasetMode";
import { navItemsForMode, navShortcutKeyForHref } from "@/lib/datasets";
import { hasStreamBaseAccess, type AppAccess } from "@/lib/appAccess";

export type Item = {
  href: string;
  label: string;
  icon: (active: boolean) => React.ReactElement;
  shortcut?: string;
};

export const navItems: Item[] = [
  {
    href: "/",
    label: "Home",
    icon: (a) => <IconHome active={a} />,
  },
  {
    href: "/playlists",
    label: "Playlists",
    icon: (a) => <IconList active={a} />,
  },
  {
    href: "/catalog",
    label: "Catalog",
    icon: (a) => <IconVinyl active={a} />,
  },
  {
    href: "/competitors",
    label: "Competitors",
    icon: (a) => <IconGrid active={a} />,
  },
  {
    href: "/collectors",
    label: "Collectors",
    icon: (a) => <IconUser active={a} />,
  },
  {
    href: "/playlist-watch",
    label: "Watch",
    icon: (a) => <IconEye active={a} />,
  },
  { href: "/health", label: "Health", icon: (a) => <IconPulse active={a} />, },
];

function SideRailContent({
  healthBadgeCount = 0,
  healthHasCritical = false,
  healthInfoOnly = false,
  datasetMode = "own",
  appAccess,
}: {
  healthBadgeCount?: number;
  healthHasCritical?: boolean;
  healthInfoOnly?: boolean;
  datasetMode?: DatasetMode;
  appAccess?: AppAccess;
}) {
  const pathname = usePathname();
  const visibleNavItems = navItemsForMode(datasetMode, navItems, appAccess);
  const showStreamBaseUtilityNav = appAccess ? hasStreamBaseAccess(appAccess) : false;

  return (
    <div className="sb-glass sticky top-3 z-30 flex flex-col items-center gap-2 px-2 py-2">
      {visibleNavItems.map((it) => {
        const active = pathname ? (pathname === it.href || pathname.startsWith(`${it.href}/`)) : false;
        const isHealth = it.href === "/health";
        const shortcut = navShortcutKeyForHref(it.href, datasetMode, appAccess);

        const competitorActive = datasetMode === "competitor" && active;
        const competitorInactive = datasetMode === "competitor" && !active;

        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? "page" : undefined}
            className={[
              "group relative grid h-9 w-9 place-items-center rounded-full transition",
              competitorActive
                ? "shadow-sm ring-1 ring-[var(--sb-accent)]/40"
                : competitorInactive
                  ? "bg-white/70 text-black/70 hover:bg-[var(--sb-accent-10)] dark:bg-white/10 dark:text-white/70 dark:hover:bg-[var(--sb-accent-10)]"
                  : active
                    ? "bg-black text-white shadow-sm dark:bg-white dark:text-black"
                    : "bg-white/70 text-black/70 hover:bg-white dark:bg-white/10 dark:text-white/70 dark:hover:bg-white/20",
            ].join(" ")}
            style={
              competitorActive
                ? { background: "var(--sb-accent)", color: "var(--sb-accent-text,#000)" }
                : undefined
            }
          >
            {it.icon(active)}

            {/* Health badge */}
            {isHealth && healthBadgeCount > 0 && (
              <span
                className={[
                  "absolute -right-0.5 -top-0.5 z-[100] flex h-5 min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold leading-none whitespace-nowrap",
                  healthHasCritical
                    ? "bg-red-500 text-white"
                    : healthInfoOnly
                      ? "bg-blue-500 text-white"
                      : "bg-orange-500 text-white",
                ].join(" ")}
                style={{ boxShadow: "0 2px 6px rgba(0, 0, 0, 0.25)" }}
                title={`${healthBadgeCount} warning${healthBadgeCount !== 1 ? "s" : ""}${healthHasCritical ? " (critical)" : ""}`}
              >
                {healthBadgeCount > 99 ? "99+" : healthBadgeCount}
              </span>
            )}

            {/* CSS-only tooltip */}
            <span
              className="pointer-events-none absolute left-full ml-3 flex items-center gap-2 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
              style={{
                background: "var(--sb-card)",
                color: "var(--sb-text)",
                border: "1px solid var(--sb-border-2)",
                backdropFilter: "blur(12px)",
              }}
            >
              {it.label}
              {shortcut ? (
                <kbd
                  className="rounded border px-1.5 py-0.5 text-[10px] font-medium"
                  style={{
                    borderColor: "var(--sb-border)",
                    background: "var(--sb-surface)",
                    color: "var(--sb-muted)",
                  }}
                >
                  {shortcut}
                </kbd>
              ) : null}
            </span>
          </Link>
        );
      })}

      {showStreamBaseUtilityNav ? (
        <>
          <div className="my-2 h-px w-full" style={{ background: "var(--sb-border)" }} />

          <Link
            href="/settings"
            className="group relative grid h-9 w-9 place-items-center rounded-full transition hover:opacity-90"
            style={{
              background: "var(--sb-accent)",
              color: "var(--sb-accent-text,#000)",
              boxShadow: "var(--sb-shadow-compact)",
            }}
          >
            <IconGear />
            {/* CSS-only tooltip */}
            <span
              className="pointer-events-none absolute left-full ml-3 flex items-center gap-2 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
              style={{
                background: "var(--sb-card)",
                color: "var(--sb-text)",
                border: "1px solid var(--sb-border-2)",
                backdropFilter: "blur(12px)",
              }}
            >
              Settings
              <kbd
                className="rounded border px-1.5 py-0.5 text-[10px] font-medium"
                style={{
                  borderColor: "var(--sb-border)",
                  background: "var(--sb-surface)",
                  color: "var(--sb-muted)",
                }}
              >
                g s
              </kbd>
            </span>
          </Link>
        </>
      ) : null}
    </div>
  );
}

export function SideRail({
  healthBadgeCount = 0,
  healthHasCritical = false,
  healthInfoOnly = false,
  datasetMode = "own",
  appAccess,
}: {
  healthBadgeCount?: number;
  healthHasCritical?: boolean;
  healthInfoOnly?: boolean;
  datasetMode?: DatasetMode;
  appAccess?: AppAccess;
}) {
  return (
    <aside className="hidden w-[60px] shrink-0 sm:block">
      <SideRailContent healthBadgeCount={healthBadgeCount} healthHasCritical={healthHasCritical} healthInfoOnly={healthInfoOnly} datasetMode={datasetMode} appAccess={appAccess} />
    </aside>
  );
}

export function IconGrid(props: { active: boolean }) {
  const iconClass = "text-current";
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
  const iconClass = "text-current";
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
  const iconClass = "text-current";
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
  const iconClass = "text-current";
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

export function IconEye(props: { active: boolean }) {
  const iconClass = "text-current";
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className={iconClass}>
      <path
        d="M2.5 12C4.5 7.5 8 5.5 12 5.5C16 5.5 19.5 7.5 21.5 12C19.5 16.5 16 18.5 12 18.5C8 18.5 4.5 16.5 2.5 12Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
    </svg>
  );
}

export function IconHome(props: { active: boolean }) {
  const iconClass = "text-current";
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className={iconClass}>
      <path
        d="M3 12L5 10M5 10L12 3L19 10M5 10V20C5 20.5523 5.44772 21 6 21H9M19 10L21 12M19 10V20C19 20.5523 18.5523 21 18 21H15M9 21C9.55228 21 10 20.5523 10 20V16C10 15.4477 10.4477 15 11 15H13C13.5523 15 14 15.4477 14 16V20C14 20.5523 14.4477 21 15 21M9 21H15"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconMusic(props: { active: boolean }) {
  const iconClass = "text-current";
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className={iconClass}>
      <path
        d="M9 18V5L21 3V16"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="6" cy="18" r="3" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="18" cy="16" r="3" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export function IconVinyl(props: { active: boolean }) {
  const iconClass = "text-current";
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className={iconClass}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </svg>
  );
}

export function IconGear() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-current">
      <path
        d="M12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M19.4 15C19.2669 15.3016 19.2272 15.6362 19.286 15.9606C19.3448 16.285 19.4995 16.5843 19.73 16.82L19.79 16.88C19.976 17.0657 20.1235 17.2863 20.2241 17.5291C20.3248 17.7719 20.3766 18.0322 20.3766 18.295C20.3766 18.5578 20.3248 18.8181 20.2241 19.0609C20.1235 19.3037 19.976 19.5243 19.79 19.71C19.6043 19.896 19.3837 20.0435 19.1409 20.1441C18.8981 20.2448 18.6378 20.2966 18.375 20.2966C18.1122 20.2966 17.8519 20.2448 17.6091 20.1441C17.3663 20.0435 17.1457 19.896 16.96 19.71L16.9 19.65C16.6643 19.4195 16.365 19.2648 16.0406 19.206C15.7162 19.1472 15.3816 19.1869 15.08 19.32C14.7842 19.4468 14.532 19.6572 14.3543 19.9255C14.1766 20.1938 14.0813 20.5082 14.08 20.83V21C14.08 21.5304 13.8693 22.0391 13.4942 22.4142C13.1191 22.7893 12.6104 23 12.08 23C11.5496 23 11.0409 22.7893 10.6658 22.4142C10.2907 22.0391 10.08 21.5304 10.08 21V20.91C10.0723 20.579 9.96512 20.258 9.77251 19.9887C9.5799 19.7194 9.31074 19.5143 9 19.4C8.69838 19.2669 8.36381 19.2272 8.03941 19.286C7.71502 19.3448 7.41568 19.4995 7.18 19.73L7.12 19.79C6.93425 19.976 6.71368 20.1235 6.47088 20.2241C6.22808 20.3248 5.96783 20.3766 5.705 20.3766C5.44217 20.3766 5.18192 20.3248 4.93912 20.2241C4.69632 20.1235 4.47575 19.976 4.29 19.79C4.10405 19.6043 3.95653 19.3837 3.85588 19.1409C3.75523 18.8981 3.70343 18.6378 3.70343 18.375C3.70343 18.1122 3.75523 17.8519 3.85588 17.6091C3.95653 17.3663 4.10405 17.1457 4.29 16.96L4.35 16.9C4.58054 16.6643 4.73519 16.365 4.794 16.0406C4.85282 15.7162 4.81312 15.3816 4.68 15.08C4.55324 14.7842 4.34276 14.532 4.07447 14.3543C3.80618 14.1766 3.49179 14.0813 3.17 14.08H3C2.46957 14.08 1.96086 13.8693 1.58579 13.4942C1.21071 13.1191 1 12.6104 1 12.08C1 11.5496 1.21071 11.0409 1.58579 10.6658C1.96086 10.2907 2.46957 10.08 3 10.08H3.09C3.42099 10.0723 3.742 9.96512 4.01131 9.77251C4.28062 9.5799 4.48571 9.31074 4.6 9C4.73312 8.69838 4.77282 8.36381 4.714 8.03941C4.65519 7.71502 4.50054 7.41568 4.27 7.18L4.21 7.12C4.02405 6.93425 3.87653 6.71368 3.77588 6.47088C3.67523 6.22808 3.62343 5.96783 3.62343 5.705C3.62343 5.44217 3.67523 5.18192 3.77588 4.93912C3.87653 4.69632 4.02405 4.47575 4.21 4.29C4.39575 4.10405 4.61632 3.95653 4.85912 3.85588C5.10192 3.75523 5.36217 3.70343 5.625 3.70343C5.88783 3.70343 6.14808 3.75523 6.39088 3.85588C6.63368 3.95653 6.85425 4.10405 7.04 4.29L7.1 4.35C7.33568 4.58054 7.63502 4.73519 7.95941 4.794C8.28381 4.85282 8.61838 4.81312 8.92 4.68H9C9.29577 4.55324 9.54802 4.34276 9.72569 4.07447C9.90337 3.80618 9.99872 3.49179 10 3.17V3C10 2.46957 10.2107 1.96086 10.5858 1.58579C10.9609 1.21071 11.4696 1 12 1C12.5304 1 13.0391 1.21071 13.4142 1.58579C13.7893 1.96086 14 2.46957 14 3V3.09C14.0013 3.41179 14.0966 3.72618 14.2743 3.99447C14.452 4.26276 14.7032 4.47324 14.999 4.6C15.3006 4.73312 15.6352 4.77282 15.9596 4.714C16.284 4.65519 16.5833 4.50054 16.819 4.27L16.879 4.21C17.0647 4.02405 17.2853 3.87653 17.5281 3.77588C17.7709 3.67523 18.0312 3.62343 18.294 3.62343C18.5568 3.62343 18.8171 3.67523 19.0599 3.77588C19.3027 3.87653 19.5233 4.02405 19.709 4.21C19.895 4.39575 20.0425 4.61632 20.1431 4.85912C20.2438 5.10192 20.2956 5.36217 20.2956 5.625C20.2956 5.88783 20.2438 6.14808 20.1431 6.39088C20.0425 6.63368 19.895 6.85425 19.709 7.04L19.649 7.1C19.4185 7.33568 19.2638 7.63502 19.205 7.95941C19.1462 8.28381 19.1859 8.61838 19.319 8.92V9C19.4458 9.29577 19.6562 9.54802 19.9245 9.72569C20.1928 9.90337 20.5072 9.99872 20.829 10H21C21.5304 10 22.0391 10.2107 22.4142 10.5858C22.7893 10.9609 23 11.4696 23 12C23 12.5304 22.7893 13.0391 22.4142 13.4142C22.0391 13.7893 21.5304 14 21 14H20.91C20.5882 14.0013 20.2738 14.0966 20.0055 14.2743C19.7372 14.452 19.5268 14.7032 19.4 15Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
