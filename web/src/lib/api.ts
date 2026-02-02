/**
 * Typed API utilities for consistent error handling and response parsing.
 */

/**
 * Standard API response shape for internal endpoints.
 */
export type ApiResponse<T> =
  | { success: true; data: T; error?: never }
  | { success: false; data?: never; error: string };

/**
 * Type guard to check if response is successful.
 */
export function isApiSuccess<T>(response: ApiResponse<T>): response is { success: true; data: T } {
  return response.success === true;
}

/**
 * Fetch JSON from an API endpoint with proper error handling.
 * @param url - The URL to fetch
 * @param options - Fetch options
 * @returns Parsed JSON response
 * @throws Error if response is not ok
 */
export async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  
  if (!response.ok) {
    const errorBody = await response.text().catch(() => "Unknown error");
    let errorMessage: string;
    
    try {
      const errorJson = JSON.parse(errorBody);
      errorMessage = errorJson.error || errorJson.message || `HTTP ${response.status}`;
    } catch {
      errorMessage = errorBody || `HTTP ${response.status}`;
    }
    
    throw new Error(errorMessage);
  }
  
  return response.json() as Promise<T>;
}

/**
 * Safe JSON parse with type assertion.
 * Returns null if parsing fails instead of throwing.
 */
export function safeJsonParse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * Extract a typed field from an unknown object safely.
 */
export function getField<T>(obj: unknown, key: string): T | undefined {
  if (obj && typeof obj === "object" && key in obj) {
    return (obj as Record<string, unknown>)[key] as T;
  }
  return undefined;
}

/**
 * Type-safe array check and cast.
 */
export function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * Type-safe number extraction with fallback.
 */
export function asNumber(value: unknown, fallback: number = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Type-safe string extraction with fallback.
 */
export function asString(value: unknown, fallback: string = ""): string {
  return typeof value === "string" ? value : fallback;
}

/**
 * Type-safe boolean extraction.
 */
export function asBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1" || value === 1) return true;
  return false;
}
