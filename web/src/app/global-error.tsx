"use client";

import { Button } from "@/components/ui/Button";
import "./globals.css";

export default function GlobalErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en" data-theme="dark">
      <body className="antialiased">
        <div className="flex min-h-[50vh] items-center justify-center p-4">
          <div className="sb-card flex flex-col items-center gap-4 p-8 text-center max-w-sm">
            <h1 className="font-semibold" style={{ color: "var(--sb-text)" }}>
              Something went wrong
            </h1>
            <p className="text-xs" style={{ color: "var(--sb-muted)" }}>
              {error.message}
            </p>
            <Button onClick={reset} variant="primary" size="sm">
              Try again
            </Button>
          </div>
        </div>
      </body>
    </html>
  );
}
