import "server-only";

/** Opt-in request/loader timings; labels never contain user data. */
export async function perfServerStep<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (process.env.STREAMBASE_PERF_LOG !== "1") return fn();
  const start = performance.now();
  try {
    return await fn();
  } finally {
    console.info(`[perf] ${label} ${(performance.now() - start).toFixed(1)} ms`);
  }
}
