import { supabaseServer } from "@/lib/supabase/server";
import { apiJsonErr, apiJsonOk, readJsonBodyOptional } from "@/lib/api/server";
import { requirePlaylistWatchAccess } from "@/lib/playlistWatch/access";
import { sendPlaylistWatchEmail } from "@/lib/playlistWatch/emailAlerts";

export async function POST(req: Request) {
  const sb = await supabaseServer();
  const auth = await requirePlaylistWatchAccess(sb);
  if (!auth.ok) return auth.response;

  const body = await readJsonBodyOptional(req);
  const recipientEmail = String(body.recipientEmail ?? auth.user.email ?? "").trim();
  if (!recipientEmail) return apiJsonErr("recipient_email_required", 400);

  try {
    await sendPlaylistWatchEmail({
      to: recipientEmail,
      subject: "[StreamBase] Playlist Watch test notification",
      text: [
        "This is a test notification from Playlist Watch.",
        "",
        "If you received this, your alert email settings are ready.",
      ].join("\n"),
    });
  } catch (error) {
    return apiJsonErr(error instanceof Error ? error.message : String(error), 500);
  }

  return apiJsonOk({ recipientEmail });
}
