import { NextResponse } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { cachedQuery } from "@/lib/supabase/cache";
import { retrieveDocs } from "@/lib/sai/docs";
import { planMessage } from "@/lib/sai/planner";
import { runDataQuery } from "@/lib/sai/tools";
import type { SaiAssistantMeta, SaiEnvelope, SaiStreamEvent } from "@/lib/sai/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  conversationId?: unknown;
  message?: unknown;
  envelope?: unknown;
};

function jsonLine(ev: SaiStreamEvent) {
  return `${JSON.stringify(ev)}\n`;
}

function chunkText(s: string, size = 48): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out;
}

export async function POST(req: Request) {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  const user = data.user;
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const conversationId = String(body.conversationId ?? "").trim();
  const message = String(body.message ?? "").trim();
  const envelope = (body.envelope ?? {}) as SaiEnvelope;

  if (!conversationId) return NextResponse.json({ error: "missing conversationId" }, { status: 400 });
  if (!message) return NextResponse.json({ error: "missing message" }, { status: 400 });

  const svc = supabaseService();

  // Verify conversation belongs to user and is not deleted.
  const { data: convo, error: convoErr } = await svc
    .from("sai_conversations")
    .select("id,user_id,deleted_at")
    .eq("id", conversationId)
    .maybeSingle();

  if (convoErr || !convo?.id) return NextResponse.json({ error: "conversation not found" }, { status: 404 });
  if (String((convo as any).user_id) !== user.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if ((convo as any).deleted_at) return NextResponse.json({ error: "conversation deleted" }, { status: 410 });

  // Persist user message immediately.
  await svc.from("sai_messages").insert([
    {
      conversation_id: conversationId,
      user_id: user.id,
      role: "user",
      content: message,
      meta: { envelope },
    },
  ]);

  const plan = planMessage(message, envelope);

  // Build assistant response using the two lanes.
  const meta: SaiAssistantMeta = { envelope, plan, citations: [], toolCalls: [], warnings: [] };

  let answer = "";

  // Lane A: docs retrieval (lexical now; embeddings can be plugged later).
  if (plan.lane === "docs" || plan.lane === "hybrid") {
    const r = await retrieveDocs(plan.docs?.query ?? message, { maxChunks: 5 });
    meta.citations = r.citations;

    if (!r.contextText || r.confidence === "low") {
      meta.warnings?.push("Low retrieval confidence: not enough matching docs chunks.");
      answer +=
        "I couldn’t confidently find this in the docs I have indexed.\n\n" +
        "Try asking more specifically, or add/update a relevant `/docs` section.\n";
    } else {
      answer +=
        "Here’s what I can answer based on SpotiBase docs (truth-first):\n\n" +
        r.citations
          .slice(0, 3)
          .map((c, i) => `${i + 1}) ${c.title} (chunk: ${c.chunkId})`)
          .join("\n") +
        "\n\n";

      // v1 no-LLM mode: surface the most relevant excerpt(s) verbatim-ish.
      // This is intentionally conservative to avoid hallucinations.
      answer +=
        "Most relevant excerpt(s):\n\n" +
        r.contextText.split("\n---\n").slice(0, 2).join("\n---\n").trim() +
        "\n";
    }
  }

  // Lane B: tool-based data answers (whitelisted templates).
  if (plan.lane === "data" || plan.lane === "hybrid") {
    const qs = plan.data?.queries ?? [];
    for (const q of qs) {
      const res = await cachedQuery(
        async () => ({ data: await runDataQuery(svc, q), error: null }),
        `sai-tool-${q.templateId}-v1`,
        30,
      );
      if (res.data?.payload) {
        meta.toolCalls?.push(res.data.toolCall);
        answer +=
          (answer ? "\n\n" : "") +
          "Data answer (calculated from safe query templates):\n\n" +
          `Template: \`${q.templateId}\`\n` +
          `Payload: \`${JSON.stringify(res.data.payload)}\`\n`;
      } else {
        meta.toolCalls?.push(res.data?.toolCall ?? { tool: "data_query", templateId: q.templateId, params: q.params });
        answer +=
          (answer ? "\n\n" : "") +
          `I attempted a data query (\`${q.templateId}\`) but it returned no data or errored.\n`;
      }
    }
  }

  // Persist assistant message (full text + metadata).
  await svc.from("sai_messages").insert([
    {
      conversation_id: conversationId,
      user_id: user.id,
      role: "assistant",
      content: answer,
      meta,
    },
  ]);

  // Stream the answer out as newline-delimited JSON events.
  const stream = new ReadableStream({
    start(controller) {
      try {
        controller.enqueue(new TextEncoder().encode(jsonLine({ type: "meta", meta })));
        for (const part of chunkText(answer, 64)) {
          controller.enqueue(new TextEncoder().encode(jsonLine({ type: "delta", text: part })));
        }
        controller.enqueue(
          new TextEncoder().encode(
            jsonLine({ type: "done", message: { role: "assistant", content: answer, meta } }),
          ),
        );
      } catch (e: any) {
        controller.enqueue(new TextEncoder().encode(jsonLine({ type: "error", error: e?.message ?? "stream error" })));
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

