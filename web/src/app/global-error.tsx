"use client";

import { Button } from "@/components/ui/Button";
import "./globals.css";

export default function GlobalErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                const STORAGE_KEY = "sb-theme";
                try {
                  const stored = localStorage.getItem(STORAGE_KEY);
                  const theme = (stored === "light" || stored === "dark") ? stored : "dark";
                  document.documentElement.dataset.theme = theme;
                } catch {
                  // ignore errors (e.g., in private browsing)
                  document.documentElement.dataset.theme = "dark";
                }
              })();
            `,
          }}
        />
      </head>
      <body className="antialiased">
        <div className="flex min-h-[50vh] items-center justify-center p-4">
          <div className="sb-card flex flex-col items-center gap-4 p-8 text-center max-w-sm">
            <h1 className="font-semibold" style={{ color: "var(--sb-text)" }}>
              Something went wrong
            </h1>
            <p className="text-xs" style={{ color: "var(--sb-muted)" }}>
              {process.env.NODE_ENV === "production"
                ? "An unexpected error occurred. Please try again."
                : error.message}
            </p>
            {error.digest ? (
              <p className="text-xs" style={{ color: "var(--sb-muted)" }}>
                Error reference: {error.digest}
              </p>
            ) : null}
            <Button onClick={reset} variant="primary" size="sm">
              Try again
            </Button>
          </div>
        </div>
      </body>
    </html>
  );
}
