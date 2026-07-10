import { NextResponse } from "next/server";
import { z } from "zod";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

const metricSchema = z.object({
  name: z.string().min(1).max(64),
  value: z.number().finite().min(0).max(3_600_000),
  unit: z.enum(["ms", "score"]).default("ms"),
  path: z.string().startsWith("/").max(160),
  datasetMode: z.enum(["own", "competitor"]).nullable().optional(),
  detail: z.record(z.string(), z.union([z.string().max(120), z.number().finite(), z.boolean(), z.null()])).optional(),
});
const payloadSchema = z.object({ metrics: z.array(metricSchema).min(1).max(30) });

function userAgentFamily(value: string | null) {
  const ua = value ?? "";
  if (/Edg\//.test(ua)) return "edge";
  if (/Chrome\//.test(ua)) return "chrome";
  if (/Firefox\//.test(ua)) return "firefox";
  if (/Safari\//.test(ua)) return "safari";
  return "other";
}

export async function POST(request: Request) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = payloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid metrics payload" }, { status: 400 });

  const agent = userAgentFamily(request.headers.get("user-agent"));
  const rows = parsed.data.metrics.map((metric) => ({
    user_id: user.id,
    route: metric.path,
    dataset_mode: metric.datasetMode ?? null,
    metric_name: metric.name,
    metric_value: metric.value,
    metric_unit: metric.unit,
    metadata: metric.detail ?? {},
    user_agent_family: agent,
  }));
  const { error } = await supabaseService().from("web_performance_metrics").insert(rows);
  if (error) return NextResponse.json({ error: "Telemetry unavailable" }, { status: 503 });
  return new NextResponse(null, { status: 204 });
}
