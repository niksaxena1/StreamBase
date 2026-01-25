"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Home } from "lucide-react";

type BreadcrumbItem = {
  label: string;
  href: string;
};

export function Breadcrumbs() {
  const pathname = usePathname();

  // Build breadcrumbs from pathname
  const segments = pathname.split("/").filter(Boolean);
  const breadcrumbs: BreadcrumbItem[] = [];

  // Always start with home
  breadcrumbs.push({ label: "Home", href: "/" });

  // Build path segments with better label formatting
  let currentPath = "";
  for (const segment of segments) {
    currentPath += `/${segment}`;
    
    // Skip dynamic route segments (UUIDs, ISRCs, etc.) - they're too long
    if (segment.length > 20 || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) {
      // For dynamic routes, use a shorter label
      const parentLabel = segments[segments.indexOf(segment) - 1];
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
        return (
          <div key={crumb.href} className="flex items-center gap-1.5">
            {index === 0 ? (
              <Link
                href={crumb.href}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                style={{ color: isLast ? "var(--sb-text)" : "var(--sb-muted)" }}
              >
                <Home className="h-3 w-3" />
              </Link>
            ) : (
              <>
                <ChevronRight className="h-3 w-3" style={{ color: "var(--sb-muted)" }} />
                {isLast ? (
                  <span className="font-medium" style={{ color: "var(--sb-text)" }}>
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
