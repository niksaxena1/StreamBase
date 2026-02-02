/**
 * Shared localStorage utilities with SSR safety.
 * All functions handle server-side rendering gracefully.
 */

/**
 * Read a boolean value from localStorage.
 * @param key - Storage key
 * @param fallback - Default value if not found or on server
 * @returns The stored boolean or fallback
 */
export function readStoredBool(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  try {
    const v = localStorage.getItem(key);
    if (v == null) return fallback;
    if (v === "1" || v === "true") return true;
    if (v === "0" || v === "false") return false;
    return fallback;
  } catch {
    return fallback;
  }
}

/**
 * Write a boolean value to localStorage.
 * @param key - Storage key
 * @param value - Boolean value to store
 */
export function writeStoredBool(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // ignore (private mode, disabled storage, etc.)
  }
}

/**
 * Read a string value from localStorage.
 * @param key - Storage key
 * @returns The stored string or null
 */
export function readStoredString(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = localStorage.getItem(key);
    return v == null ? null : String(v);
  } catch {
    return null;
  }
}

/**
 * Write a string value to localStorage.
 * @param key - Storage key
 * @param value - String value to store
 */
export function writeStoredString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore (private mode, disabled storage, etc.)
  }
}

/**
 * Remove an item from localStorage.
 * @param key - Storage key to remove
 */
export function removeStoredItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

/**
 * Read a JSON value from localStorage.
 * @param key - Storage key
 * @returns The parsed JSON value or null
 */
export function readStoredJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const v = localStorage.getItem(key);
    if (v == null) return null;
    return JSON.parse(v) as T;
  } catch {
    return null;
  }
}

/**
 * Write a JSON value to localStorage.
 * @param key - Storage key
 * @param value - Value to serialize and store
 */
export function writeStoredJson<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore (private mode, disabled storage, etc.)
  }
}

/**
 * Read a number value from localStorage.
 * @param key - Storage key
 * @param fallback - Default value if not found or invalid
 * @returns The stored number or fallback
 */
export function readStoredNumber(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  try {
    const v = localStorage.getItem(key);
    if (v == null) return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Write a number value to localStorage.
 * @param key - Storage key
 * @param value - Number value to store
 */
export function writeStoredNumber(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // ignore
  }
}
