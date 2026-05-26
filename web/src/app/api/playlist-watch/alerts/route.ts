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

function mapRule(row: Record<string, unknown>, playlistIds: string[]) {
  return {
    id: Number(row.id),
    recipientEmail: String(row.recipient_email ?? ""),
    ruleName: String(row.rule_name ?? "Playlist follower spike"),
    isActive: Boolean(row.is_active),
    minAbsoluteJump: row.min_absolute_jump === null ? null : Number(row.min_absolute_jump),
    minPercentJump: row.min_percent_jump === null ? null : Number(row.min_percent_jump),
    comparisonWindowDays: Number(row.comparison_window_days ?? 7),
    playlistIds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function GET() {
  const sb = await supabaseServer();
  const auth = await requirePlaylistWatchAccess(sb);
  if (!auth.ok) return auth.response;

  const svc = supabaseService().schema("playlist_watch");
  const { data: rules, error: rulesErr } = await svc
    .from("alert_rules")
    .select("id,recipient_email,rule_name,is_active,min_absolute_jump,min_percent_jump,comparison_window_days,created_at,updated_at")
    .eq("user_id", auth.user.id)
    .order("id", { ascending: true });
  if (rulesErr) return apiJsonErr(rulesErr.message, 500);

  const ruleIds = (rules ?? []).map((row) => row.id);
  const { data: scopes, error: scopesErr } = ruleIds.length
    ? await svc.from("alert_rule_playlists").select("rule_id,spotify_playlist_id").in("rule_id", ruleIds)
    : { data: [], error: null };
  if (scopesErr) return apiJsonErr(scopesErr.message, 500);

  const scopeByRule = new Map<number, string[]>();
  for (const row of scopes ?? []) {
    const ruleId = Number(row.rule_id);
    scopeByRule.set(ruleId, [...(scopeByRule.get(ruleId) ?? []), String(row.spotify_playlist_id)]);
  }

  const { data: events, error: eventsErr } = await svc
    .from("alert_events")
    .select("id,rule_id,recipient_email,spotify_playlist_id,run_date,baseline_count,current_count,absolute_jump,percent_jump,comparison_window_days,status,error_message,sent_at")
    .eq("user_id", auth.user.id)
    .order("run_date", { ascending: false })
    .order("id", { ascending: false })
    .limit(500);
  if (eventsErr) return apiJsonErr(eventsErr.message, 500);

  return apiJsonOk({
    rules: (rules ?? []).map((row) => mapRule(row, scopeByRule.get(Number(row.id)) ?? [])),
    events: events ?? [],
  });
}

export async function POST(req: Request) {
  const sb = await supabaseServer();
  const auth = await requirePlaylistWatchAccess(sb);
  if (!auth.ok) return auth.response;

  const body = await readJsonBodyOptional(req);
  const recipientEmail = String(body.recipientEmail ?? auth.user.email ?? "").trim();
  const ruleName = String(body.ruleName ?? "Playlist follower spike").trim() || "Playlist follower spike";
  const minAbsoluteJump = toPositiveNumber(body.minAbsoluteJump);
  const minPercentJump = toPositiveNumber(body.minPercentJump);
  const comparisonWindowDays = Math.max(1, Math.min(30, Math.round(Number(body.comparisonWindowDays ?? 7) || 7)));
  const playlistIds = parsePlaylistIds(body.playlistIds);

  if (!recipientEmail) return apiJsonErr("recipient_email_required", 400);
  if (minAbsoluteJump === null && minPercentJump === null) return apiJsonErr("threshold_required", 400);

  const svc = supabaseService().schema("playlist_watch");
  const { data: inserted, error: insertErr } = await svc
    .from("alert_rules")
    .insert({
      user_id: auth.user.id,
      recipient_email: recipientEmail,
      rule_name: ruleName,
      is_active: body.isActive !== false,
      min_absolute_jump: minAbsoluteJump,
      min_percent_jump: minPercentJump,
      comparison_window_days: comparisonWindowDays,
    })
    .select("id,recipient_email,rule_name,is_active,min_absolute_jump,min_percent_jump,comparison_window_days,created_at,updated_at")
    .single();
  if (insertErr) return apiJsonErr(insertErr.message, 500);

  if (playlistIds.length > 0) {
    const { error: scopeErr } = await svc
      .from("alert_rule_playlists")
      .insert(playlistIds.map((playlistId) => ({ rule_id: inserted.id, spotify_playlist_id: playlistId })));
    if (scopeErr) return apiJsonErr(scopeErr.message, 500);
  }

  return apiJsonOk({ rule: mapRule(inserted, playlistIds) }, { status: 201 });
}
