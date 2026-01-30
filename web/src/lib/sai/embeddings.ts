type EmbedResult = { vectors: number[][] };

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export function embeddingsEnabled(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

export function embeddingModel(): string {
  return process.env.OPENAI_EMBED_MODEL ?? "text-embedding-3-small";
}

export function embeddingDims(): number {
  // Keep in sync with DB migration vector(1536).
  // If you change models to a different dimension, update the migration + RPC cast.
  return Number(process.env.SAI_EMBED_DIMS ?? 1536);
}

export async function embedTexts(texts: string[]): Promise<EmbedResult> {
  const key = requireEnv("OPENAI_API_KEY");
  const model = embeddingModel();

  const resp = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: texts,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`OpenAI embeddings HTTP ${resp.status}: ${body.slice(0, 500)}`);
  }

  const json = (await resp.json()) as any;
  const vectors = (json?.data ?? []).map((d: any) => d?.embedding).filter(Boolean);
  return { vectors };
}

