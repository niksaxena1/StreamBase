export function homePrefetchKey(mode: "own" | "competitor", label: string | null, revision: string, url: string) {
  return JSON.stringify([mode, label, revision, url]);
}

/** Dashboard-lifetime cache: open and idle consumers share pending AND settled requests. */
export function createHomeRequestCache() {
  const requests = new Map<string, Promise<unknown>>();
  return {
    get<T>(key: string, load: () => Promise<T>): Promise<T> {
      const cached = requests.get(key);
      if (cached) return cached as Promise<T>;
      const request = Promise.resolve().then(load).then((value) => {
        if (value && typeof value === "object" && "errorMessage" in value && value.errorMessage != null) {
          throw new Error(String(value.errorMessage));
        }
        return value;
      });
      requests.set(key, request);
      // A failed warm-up must not prevent a later user-triggered retry.
      void request.catch(() => { if (requests.get(key) === request) requests.delete(key); });
      return request;
    },
  };
}

type PrefetchEnvironment = {
  isVisible: () => boolean;
  idle: (callback: () => void) => () => void;
  delay: (callback: () => void, ms: number) => () => void;
  onVisibilityChange: (callback: () => void) => () => void;
};

/** Call only after primary content mounts. Never start background work in a hidden tab. */
export function scheduleHomePrefetch(
  tasks: Array<() => void>,
  env: PrefetchEnvironment,
  { initialDelayMs = 1800, staggerMs = 250 } = {},
): () => void {
  let index = 0;
  let stopped = false;
  let cancelPending: (() => void) | undefined;
  const queue = (delay: number) => {
    if (stopped || index >= tasks.length || !env.isVisible()) return;
    cancelPending = env.delay(() => {
      cancelPending = undefined;
      if (stopped || !env.isVisible()) return;
      cancelPending = env.idle(() => {
        cancelPending = undefined;
        if (stopped || !env.isVisible()) return;
        tasks[index++]();
        queue(staggerMs);
      });
    }, delay);
  };
  const unsubscribe = env.onVisibilityChange(() => {
    cancelPending?.();
    cancelPending = undefined;
    queue(staggerMs);
  });
  queue(initialDelayMs);
  return () => { stopped = true; cancelPending?.(); unsubscribe(); };
}

export function scheduleVisibleHomePrefetch(tasks: Array<() => void>, initialDelayMs?: number) {
  return scheduleHomePrefetch(tasks, {
    isVisible: () => document.visibilityState === "visible",
    idle: (callback) => {
      if (typeof window.requestIdleCallback === "function") {
        const id = window.requestIdleCallback(callback, { timeout: 3000 });
        return () => window.cancelIdleCallback(id);
      }
      const id = window.setTimeout(callback, 50);
      return () => window.clearTimeout(id);
    },
    delay: (callback, ms) => {
      const id = window.setTimeout(callback, ms);
      return () => window.clearTimeout(id);
    },
    onVisibilityChange: (callback) => {
      document.addEventListener("visibilitychange", callback);
      return () => document.removeEventListener("visibilitychange", callback);
    },
  }, { initialDelayMs });
}
