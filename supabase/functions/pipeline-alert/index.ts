// Sends queued StreamBase pipeline alerts (ops.pipeline_alerts) by Gmail SMTP.
//
// Called by ops.flush_alerts() via pg_net. It accepts no input: it claims
// pending rows with its own service-role key, so a caller can only trigger
// delivery of alerts the database already queued (no open mail relay).
//
// Deploy with JWT verification off (pg_net sends no auth header):
//   supabase functions deploy pipeline-alert --no-verify-jwt
// Secret: NOTIFY_SMTP_PASSWORD (Gmail app password for nikhil.auh@gmail.com).
// Port 465 (implicit TLS): Edge Functions block outbound 25 and 587.
import nodemailer from "npm:nodemailer@6.9.16";

const SMTP_USER = "nikhil.auh@gmail.com";

async function rpc(name: string, body: Record<string, unknown>) {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  const res = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${name} failed: HTTP ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

Deno.serve(async () => {
  const password = Deno.env.get("NOTIFY_SMTP_PASSWORD");
  const alerts = ((await rpc("pipeline_claim_alerts", {})) ?? []) as Array<{
    id: number;
    subject: string;
    body: string;
  }>;
  if (alerts.length === 0) return Response.json({ sent: 0 });

  if (!password) {
    for (const a of alerts) await rpc("pipeline_mark_alert", { p_id: a.id, p_error: "NOTIFY_SMTP_PASSWORD not set" });
    return Response.json({ sent: 0, error: "NOTIFY_SMTP_PASSWORD not set" }, { status: 500 });
  }

  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: SMTP_USER, pass: password },
  });

  let sent = 0;
  for (const a of alerts) {
    try {
      await transport.sendMail({
        from: `StreamBase Pipeline <${SMTP_USER}>`,
        to: SMTP_USER,
        subject: a.subject,
        text: a.body,
      });
      await rpc("pipeline_mark_alert", { p_id: a.id });
      sent++;
    } catch (err) {
      await rpc("pipeline_mark_alert", { p_id: a.id, p_error: String(err).slice(0, 500) });
    }
  }
  return Response.json({ sent, total: alerts.length });
});
