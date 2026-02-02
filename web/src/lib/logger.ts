/**
 * Conditional logging utility.
 * In production, debug and log messages are suppressed.
 * Errors and warnings are always logged.
 */

const isDev = process.env.NODE_ENV === "development";

/**
 * Log debug information (development only).
 */
export function logDebug(message: string, ...args: unknown[]): void {
  if (isDev) {
    console.log(`[DEBUG] ${message}`, ...args);
  }
}

/**
 * Log general information (development only).
 */
export function logInfo(message: string, ...args: unknown[]): void {
  if (isDev) {
    console.log(`[INFO] ${message}`, ...args);
  }
}

/**
 * Log warnings (always logged).
 */
export function logWarn(message: string, ...args: unknown[]): void {
  console.warn(`[WARN] ${message}`, ...args);
}

/**
 * Log errors (always logged).
 * Use this instead of console.error for consistent formatting.
 */
export function logError(message: string, error?: unknown, ...args: unknown[]): void {
  if (error instanceof Error) {
    console.error(`[ERROR] ${message}:`, error.message, ...args);
    if (isDev && error.stack) {
      console.error(error.stack);
    }
  } else if (error !== undefined) {
    console.error(`[ERROR] ${message}:`, error, ...args);
  } else {
    console.error(`[ERROR] ${message}`, ...args);
  }
}

/**
 * Log API/fetch errors with context.
 */
export function logApiError(
  context: string,
  url: string,
  error: unknown,
  extra?: Record<string, unknown>
): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error(`[API ERROR] ${context}`, {
    url,
    error: errorMessage,
    ...extra,
  });
}

/**
 * Create a scoped logger for a specific module/component.
 */
export function createLogger(scope: string) {
  return {
    debug: (message: string, ...args: unknown[]) => logDebug(`[${scope}] ${message}`, ...args),
    info: (message: string, ...args: unknown[]) => logInfo(`[${scope}] ${message}`, ...args),
    warn: (message: string, ...args: unknown[]) => logWarn(`[${scope}] ${message}`, ...args),
    error: (message: string, error?: unknown, ...args: unknown[]) =>
      logError(`[${scope}] ${message}`, error, ...args),
  };
}
