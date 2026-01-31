function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export function chatModel(): string {
  return process.env.OPENAI_CHAT_MODEL ?? "gpt-4o-mini";
}

export type DocsSynthesisResult = {
  answer: string;
  usedChunkIds: string[];
  missingInfo: string[];
};

function safeJsonParse<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

export async function synthesizeFromDocs(opts: {
  question: string;
  context: string;
  availableChunkIds: string[];
}): Promise<DocsSynthesisResult> {
  const key = requireEnv("OPENAI_API_KEY");
  const model = chatModel();

  const system = [
    "You are SAI (SpotiBase AI). Your top priority is accuracy and reliability.",
    "You MUST answer using ONLY the provided CONTEXT. Do not use outside knowledge.",
    "If the answer is not clearly supported by CONTEXT, say you don't know and explain what doc section is missing.",
    "",
    "Return STRICT JSON only with this shape:",
    "{",
    '  "answer": string,',
    '  "usedChunkIds": string[],',
    '  "missingInfo": string[]',
    "}",
    "",
    "Citations rules:",
    "- You may only cite chunk ids that are in availableChunkIds.",
    "- usedChunkIds should include every chunk you relied on.",
  ].join("\n");

  const user = [
    `QUESTION:\n${opts.question}`,
    "",
    `availableChunkIds:\n${JSON.stringify(opts.availableChunkIds)}`,
    "",
    "CONTEXT (docs excerpts):",
    opts.context,
  ].join("\n");

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`OpenAI chat HTTP ${resp.status}: ${body.slice(0, 500)}`);
  }

  const json = (await resp.json()) as any;
  const text = String(json?.choices?.[0]?.message?.content ?? "").trim();
  const parsed = safeJsonParse<DocsSynthesisResult>(text);

  if (!parsed || typeof parsed.answer !== "string") {
    return {
      answer: "I couldn't parse the model output. Please try again.",
      usedChunkIds: [],
      missingInfo: ["Model output was not valid JSON."],
    };
  }

  const allowed = new Set(opts.availableChunkIds);
  const usedChunkIds = (parsed.usedChunkIds ?? []).filter((id) => allowed.has(id));
  const missingInfo = Array.isArray(parsed.missingInfo) ? parsed.missingInfo.map(String) : [];

  return { answer: parsed.answer.trim(), usedChunkIds, missingInfo };
}

