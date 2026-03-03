"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { logError } from "@/lib/logger";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logError("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div
          className="flex min-h-[300px] flex-col items-center justify-center gap-4 rounded-xl border p-8"
          style={{
            borderColor: "var(--sb-border)",
            background: "var(--sb-surface)",
            color: "var(--sb-text)",
          }}
        >
          <div className="text-center space-y-2">
            <h2 className="text-lg font-semibold">Something went wrong</h2>
            <p
              className="text-sm max-w-md"
              style={{ color: "var(--sb-muted)" }}
            >
              An unexpected error occurred. Try refreshing the page.
            </p>
            {this.state.error?.message && (
              <pre
                className="mt-3 max-w-lg overflow-auto rounded-lg p-3 text-xs"
                style={{
                  background: "var(--sb-bg)",
                  color: "var(--sb-muted)",
                }}
              >
                {this.state.error.message}
              </pre>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
            className="sb-ring rounded-full bg-black px-4 py-2 text-sm font-medium text-white hover:bg-black/90 dark:bg-white dark:text-black dark:hover:bg-white/90"
          >
            Reload page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
