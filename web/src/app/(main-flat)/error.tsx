"use client";

import { Button } from "@/components/ui/Button";

export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center p-4">
      <div className="sb-card flex flex-col items-center gap-4 p-8 text-center max-w-sm">
        <p className="font-semibold" style={{ color: "var(--sb-text)" }}>
          Something went wrong
        </p>
        <p className="text-xs" style={{ color: "var(--sb-muted)" }}>
          {error.message}
        </p>
        <Button onClick={reset} variant="primary" size="sm">
          Try again
        </Button>
      </div>
    </div>
  );
}
