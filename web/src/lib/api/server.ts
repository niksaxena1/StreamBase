import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";

import type { ApiResponse } from "../api";

export function apiJsonOk<T>(data: T, init?: ResponseInit): NextResponse {
  const body: ApiResponse<T> = { success: true, data };
  const status = init?.status ?? 200;
  return NextResponse.json(body, { ...init, status });
}

export function apiJsonErr(error: string, status: number): NextResponse {
  const body: ApiResponse<never> = { success: false, error };
  return NextResponse.json(body, { status });
}

export type RequireUserResult =
  | { ok: true; user: User }
  | { ok: false; response: NextResponse };

/** Validates JWT with Supabase Auth (network). Prefer for sensitive routes (exports, mutations). */
export async function requireUser(sb: SupabaseClient): Promise<RequireUserResult> {
  const { data: userData } = await sb.auth.getUser();
  if (!userData.user) return { ok: false, response: apiJsonErr("unauthenticated", 401) };
  return { ok: true, user: userData.user };
}

export async function requireSessionUser(sb: SupabaseClient): Promise<RequireUserResult> {
  return requireUser(sb);
}

export type RequireAdminResult =
  | { ok: true; user: User }
  | { ok: false; response: NextResponse };

export async function requireAdmin(sb: SupabaseClient): Promise<RequireAdminResult> {
  const u = await requireUser(sb);
  if (!u.ok) return u;
  const { data: isAdmin, error: adminErr } = await sb.rpc("is_admin");
  if (adminErr) return { ok: false, response: apiJsonErr(adminErr.message, 500) };
  if (!isAdmin) return { ok: false, response: apiJsonErr("forbidden", 403) };
  return { ok: true, user: u.user };
}

export type ReadJsonResult =
  | { ok: true; body: unknown }
  | { ok: false; response: NextResponse };

export async function readJsonBody(req: Request): Promise<ReadJsonResult> {
  try {
    const body = await req.json();
    return { ok: true, body };
  } catch {
    return { ok: false, response: apiJsonErr("invalid_json", 400) };
  }
}

/** For PATCH/POST handlers that treat a missing or invalid body as `{}`. */
export async function readJsonBodyOptional(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
    return {};
  } catch {
    return {};
  }
}
