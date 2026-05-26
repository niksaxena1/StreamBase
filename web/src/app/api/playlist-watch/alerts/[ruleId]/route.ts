import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { apiJsonErr, apiJsonOk, readJsonBodyOptional } from "@/lib/api/server";
import { requirePlaylistWatchAccess } from "@/lib/playlistWatch/access";
import { parseSpotifyPlaylistId } from "@/lib/playlistWatch/spotifyPlaylistId";

function toPositiveNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function parsePlaylistIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => parseSpotifyPlaylistId(String(item ?? "")))
        .filter((item): item is string => Boolean(item)),
    ),
  );
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ ruleId: string }> },
) {
  const params = await ctx.params;
  const ruleId = Number(params.ruleId);
  if (!Number.isInteger(ruleId) || ruleId <= 0) return apiJsonErr("invalid_rule_id", 400);

  const sb = await supabaseServer();
  const auth = await requirePlaylistWatchAccess(sb);
  if (!auth.ok) return auth.response;

  const body = await readJsonBodyOptional(req);
  const minAbsoluteJump = toPositiveNumber(body.minAbsoluteJump);
  const minPercentJump = toPositiveNumber(body.minPercentJump);
  const comparisonWindowDays = Math.max(1, Math.min(30, Math.round(Number(body.comparisonWindowDays ?? 7) || 7)));
  const playlistIds = parsePlaylistIds(body.playlistIds);
  if (minAbsoluteJump === null && minPercentJump === null) return apiJsonErr("threshold_required", 400);

  const svc = supabaseService().schema("playlist_watch");
  const { data: existing, error: existingErr } = await svc
    .from("alert_rules")
    .select("id")
    .eq("id", ruleId)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (existingErr) return apiJsonErr(existingErr.message, 500);
  if (!existing) return apiJsonErr("not_found", 404);

  const { error: updateErr } = await svc
    .from("alert_rules")
    .update({
      recipient_email: String(body.recipientEmail ?? auth.user.email ?? "").trim(),
      rule_name: String(body.ruleName ?? "Playlist follower spike").trim() || "Playlist follower spike",
      is_active: body.isActive !== false,
      min_absolute_jump: minAbsoluteJump,
      min_percent_jump: minPercentJump,
      comparison_window_days: comparisonWindowDays,
    })
    .eq("id", ruleId)
    .eq("user_id", auth.user.id);
  if (updateErr) return apiJsonErr(updateErr.message, 500);

  const { error: deleteScopeErr } = await svc.from("alert_rule_playlists").delete().eq("rule_id", ruleId);
  if (deleteScopeErr) return apiJsonErr(deleteScopeErr.message, 500);

  if (playlistIds.length > 0) {
    const { error: insertScopeErr } = await svc
      .from("alert_rule_playlists")
      .insert(playlistIds.map((playlistId) => ({ rule_id: ruleId, spotify_playlist_id: playlistId })));
    if (insertScopeErr) return apiJsonErr(insertScopeErr.message, 500);
  }

  return apiJsonOk({ id: ruleId });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ ruleId: string }> },
) {
  const params = await ctx.params;
  const ruleId = Number(params.ruleId);
  if (!Number.isInteger(ruleId) || ruleId <= 0) return apiJsonErr("invalid_rule_id", 400);

  const sb = await supabaseServer();
  const auth = await requirePlaylistWatchAccess(sb);
  if (!auth.ok) return auth.response;

  const svc = supabaseService().schema("playlist_watch");
  const { error } = await svc.from("alert_rules").delete().eq("id", ruleId).eq("user_id", auth.user.id);
  if (error) return apiJsonErr(error.message, 500);

  return apiJsonOk({ id: ruleId });
}
