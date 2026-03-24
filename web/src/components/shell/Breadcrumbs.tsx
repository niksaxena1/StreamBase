"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { logWarn } from "@/lib/logger";
import { fetchApiJson } from "@/lib/api";
import { ChevronRight, Home } from "lucide-react";

type BreadcrumbItem = {
  label: string;
  href: string;
};

export function Breadcrumbs() {
  const pathname = usePathname();
  const [customLabelsByPath, setCustomLabelsByPath] = useState<Record<string, string>>(
    {},
  );
  const customLabel = customLabelsByPath[pathname] ?? null;

  // Fetch custom labels for dynamic routes
  useEffect(() => {
    let alive = true;
    const segments = pathname.split("/").filter(Boolean);
    
    // Handle artist pages: /artists/[spotify_artist_id]
    if (segments[0] === "artists" && segments[1] && segments[1].length > 10) {
      fetchApiJson<{ artistName: string | null }>(
        `/api/breadcrumb/artist?artist_id=${encodeURIComponent(segments[1])}`,
      )
        .then((data) => {
          if (!alive) return;
          const label = (data?.artistName as string | undefined) ?? "";
          if (!label) return;
          setCustomLabelsByPath((prev) => ({ ...prev, [pathname]: label }));
        })
        .catch((error) => {
          logWarn("Breadcrumb artist fetch failed", error);
        });
      return () => { alive = false; };
    }

    // Handle catalog route
    if (segments[0] === "catalog") {
      // No custom label needed for catalog page itself
      return () => { alive = false; };
    }

    // Handle track pages: /tracks/[isrc]
    if (segments[0] === "tracks" && segments[1] && segments[1].length > 10) {
      fetchApiJson<{ trackLabel: string }>(`/api/breadcrumb/track?isrc=${encodeURIComponent(segments[1])}`)
        .then((data) => {
          if (!alive) return;
          const label = (data?.trackLabel as string | undefined) ?? "";
          if (!label) return;
          setCustomLabelsByPath((prev) => ({ ...prev, [pathname]: label }));
        })
        .catch((error) => {
          logWarn("Breadcrumb track fetch failed", error);
        });
      return () => { alive = false; };
    }

    return () => { alive = false; };
  }, [pathname]);

  // Build breadcrumbs from pathname
  const segments = pathname.split("/").filter(Boolean);
  const breadcrumbs: BreadcrumbItem[] = [];

  // Always start with home
  breadcrumbs.push({ label: "Home", href: "/" });

  // Build path segments with better label formatting
  let currentPath = "";
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    currentPath += `/${segment}`;
    
    // Special handling for dashboard routes
    if (segment === "dashboard") {
      breadcrumbs.push({ label: "Dashboard", href: currentPath });
      continue;
    }

    // Special handling for catalog route - show Home > Catalog > [Config]
    if (segment === "catalog") {
      breadcrumbs.push({ label: "Catalog", href: currentPath });
      // Next segment is "config" - add it
      if (i + 1 < segments.length && segments[i + 1] === "config") {
        currentPath += "/config";
        breadcrumbs.push({ label: "Config", href: currentPath });
        i++; // Skip the config segment
      }
      continue;
    }

    // Special handling for artists route - show Dashboard > Artists > [Artist Name]
    if (segment === "artists") {
      // Only add Dashboard if we're not already in a dashboard route
      const prevSegment = i > 0 ? segments[i - 1] : null;
      if (prevSegment !== "dashboard") {
        breadcrumbs.push({ label: "Dashboard", href: "/" });
      }
      breadcrumbs.push({ label: "Artists", href: currentPath });
      // Next segment is the artist ID - use custom label if available
      if (i + 1 < segments.length && segments[i + 1]) {
        const artistId = segments[i + 1];
        currentPath += `/${artistId}`;
        breadcrumbs.push({ 
          label: customLabel || "Artist Detail", 
          href: currentPath 
        });
        i++; // Skip the artist ID segment
      }
      continue;
    }

    // Special handling for tracks route - show Dashboard > Tracks > [Track Label]
    if (segment === "tracks") {
      // Only add Dashboard if we're not already in a dashboard route
      const prevSegment = i > 0 ? segments[i - 1] : null;
      if (prevSegment !== "dashboard") {
        breadcrumbs.push({ label: "Dashboard", href: "/" });
      }
      breadcrumbs.push({ label: "Tracks", href: currentPath });
      // Next segment is the ISRC - use custom label if available
      if (i + 1 < segments.length && segments[i + 1]) {
        const isrc = segments[i + 1];
        currentPath += `/${isrc}`;
        breadcrumbs.push({ 
          label: customLabel || "Track Detail", 
          href: currentPath 
        });
        i++; // Skip the ISRC segment
      }
      continue;
    }
    
    // Skip dynamic route segments (UUIDs, ISRCs, etc.) - they're too long
    if (segment.length > 20 || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) {
      // For dynamic routes, use a shorter label
      const parentLabel = segments[i - 1];
      const label = parentLabel 
        ? `${parentLabel.charAt(0).toUpperCase() + parentLabel.slice(1)} Detail`
        : "Detail";
      breadcrumbs.push({ label, href: currentPath });
    } else {
      // Format label (convert kebab-case to Title Case)
      const label = segment
        .split("-")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
      breadcrumbs.push({ label, href: currentPath });
    }
  }

  // Don't show breadcrumbs on home page
  if (breadcrumbs.length <= 1) {
    return null;
  }

  return (
    <nav className="flex items-center gap-1.5 text-xs" aria-label="Breadcrumb">
      {breadcrumbs.map((crumb, index) => {
        const isLast = index === breadcrumbs.length - 1;
        const wrapperClassName =
          index === 0 ? "hidden sm:flex items-center gap-1.5" : "flex items-center gap-1.5";
        return (
          <div key={crumb.href} className={wrapperClassName}>
            {index === 0 ? (
              <Link
                href={crumb.href}
                aria-label="Home"
                className="flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                style={{ color: isLast ? "var(--sb-text)" : "var(--sb-muted)" }}
              >
                <Home className="h-3 w-3" aria-hidden="true" />
              </Link>
            ) : (
              <>
                <ChevronRight className="h-3 w-3" style={{ color: "var(--sb-muted)" }} />
                {isLast ? (
                  <span aria-current="page" className="font-medium" style={{ color: "var(--sb-text)" }}>
                    {crumb.label}
                  </span>
                ) : (
                  <Link
                    href={crumb.href}
                    className="rounded px-1.5 py-0.5 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                    style={{ color: "var(--sb-muted)" }}
                  >
                    {crumb.label}
                  </Link>
                )}
              </>
            )}
          </div>
        );
      })}
    </nav>
  );
}
