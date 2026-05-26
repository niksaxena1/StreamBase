"use client";

import { usePathname } from "next/navigation";

export function AppFooter() {
  const pathname = usePathname();
  return (
    <footer className="px-2 pb-2 text-xs" style={{ color: "var(--sb-muted)" }}>
      {pathname?.startsWith("/playlist-watch") ? (
        <>Data source: Spotify API</>
      ) : (
        <>
          Data source:{" "}
          <a
            href="https://www.spotontrack.com/dashboard"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            SpotOnTrack
          </a>
          {" "}exports · Updated daily via{" "}
          <a
            href="https://github.com/niksaxena1/SBase/actions"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            GitHub Actions
          </a>
        </>
      )}
    </footer>
  );
}
