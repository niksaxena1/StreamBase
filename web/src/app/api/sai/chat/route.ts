import type { ModelMessage } from "ai";

import { supabaseServer } from "@/lib/supabase/server";
import { apiJsonErr, requireUser } from "@/lib/api/server";
import { supabaseService } from "@/lib/supabase/service";
import { createSaiTurnContext, streamSaiChat } from "@/lib/sai/llm";
import type { SaiAssistantMeta, SaiEnvelope, SaiStreamEvent } from "@/lib/sai/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  conversationId?: unknown;
  message?: unknown;
  envelope?: unknown;
  model?: unknown;
};

function jsonLine(ev: SaiStreamEvent) {
  return `${JSON.stringify(ev)}\n`;
}

type DbMsg = { role: string; content: string | null };

function toModelMessages(rows: DbMsg[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const r of rows) {
    if (r.role !== "user" && r.role !== "assistant") continue;
    const content = String(r.content ?? "").trim();
    if (!content) continue;
    out.push({ role: r.role, content });
  }
  return out;
}

export async function POST(req: Request) {
  const sb = await supabaseServer();
  const auth = await requireUser(sb);
  if (!auth.ok) return auth.response;
  const user = auth.user;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return apiJsonErr("invalid json", 400);
  }

  const conversationId = String(body.conversationId ?? "").trim();
  const message = String(body.message ?? "").trim();
  const envelope = (body.envelope ?? {}) as SaiEnvelope;
  const modelOverride = typeof body.model === "string" ? body.model.trim() : undefined;

  if (!conversationId) return apiJsonErr("missing conversationId", 400);
  if (!message) return apiJsonErr("missing message", 400);

  if (!process.env.OPENAI_API_KEY && !process.env.OPENROUTER_API_KEY) {
    return apiJsonErr("SAI is not configured (set OPENAI_API_KEY or OPENROUTER_API_KEY)", 503);
  }

  const svc = supabaseService();

  const { data: convo, error: convoErr } = await svc
    .from("sai_conversations")
    .select("id,user_id,deleted_at")
    .eq("id", conversationId)
    .maybeSingle();

  if (convoErr || !convo?.id) return apiJsonErr("conversation not found", 404);
  if (String((convo as { user_id?: string }).user_id) !== user.id) return apiJsonErr("forbidden", 403);
  if ((convo as { deleted_at?: unknown }).deleted_at) return apiJsonErr("conversation deleted", 410);

  const { data: priorRows } = await svc
    .from("sai_messages")
    .select("role,content,created_at")
    .eq("conversation_id", conversationId)
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: false })
    .limit(19);

  const history = toModelMessages([...(priorRows ?? [])].reverse() as DbMsg[]);

  await svc.from("sai_messages").insert([
    {
      conversation_id: conversationId,
      user_id: user.id,
      role: "user",
      content: message,
      meta: { envelope },
    },
  ]);

  const ctx = createSaiTurnContext();

  let result;
  try {
    result = streamSaiChat({
      supabase: svc,
      envelope,
      history,
      userMessage: message,
      ctx,
      modelOverride,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to start SAI";
    return apiJsonErr(msg, 500);
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(
          encoder.encode(
            jsonLine({
              type: "meta",
              meta: { envelope },
            }),
          ),
        );

        for await (const textPart of result.textStream) {
          controller.enqueue(encoder.encode(jsonLine({ type: "delta", text: textPart })));
        }

        const text = await result.text;

        const meta: SaiAssistantMeta = {
          envelope,
          citations: ctx.citations.length ? ctx.citations : undefined,
          toolCalls: ctx.toolCalls.length ? ctx.toolCalls : undefined,
          warnings: ctx.warnings.length ? ctx.warnings : undefined,
          retrieval: ctx.retrievalOverride ?? null,
        };

        await svc.from("sai_messages").insert([
          {
            conversation_id: conversationId,
            user_id: user.id,
            role: "assistant",
            content: text,
            meta,
          },
        ]);

        controller.enqueue(
          encoder.encode(jsonLine({ type: "done", message: { role: "assistant", content: text, meta } })),
        );
      } catch (e: unknown) {
        const err = e instanceof Error ? e.message : "stream error";
        controller.enqueue(encoder.encode(jsonLine({ type: "error", error: err })));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
