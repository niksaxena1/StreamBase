import { catalogConfigured } from "@/lib/supabase/catalogService";
import { getRequestAppContext } from "@/lib/requestAppContext.server";

export type LibraryGate = { ok: true; actor: string } | { ok: false; error: string };

/**
 * Admin check for library server actions. Returns an error value (not a redirect)
 * so the panel can show it inline. The actor recorded in change_log is the
 * signed-in user's email.
 */
export async function requireLibraryAdmin(): Promise<LibraryGate> {
  const { user, isAdmin } = await getRequestAppContext();
  if (!user || !isAdmin) return { ok: false, error: "Not allowed" };
  if (!catalogConfigured()) return { ok: false, error: "Library isn't connected" };
  return { ok: true, actor: user.email ?? user.id };
}
