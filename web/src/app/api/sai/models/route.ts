import { SAI_MODEL_OPTIONS, defaultModelId } from "@/lib/sai/llm";
import { requireUser } from "@/lib/api/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sb = await supabaseServer();
  const auth = await requireUser(sb);
  if (!auth.ok) return auth.response;

  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasOpenRouter = !!process.env.OPENROUTER_API_KEY;

  const models = SAI_MODEL_OPTIONS.filter((m) => {
    if (m.provider === "openai") return hasOpenAI;
    if (m.provider === "openrouter") return hasOpenRouter;
    return false;
  }).map((m) => ({ id: m.id, label: m.label, provider: m.provider }));

  return Response.json({ models, default: defaultModelId() });
}
