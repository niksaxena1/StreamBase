-- Migration: SAI docs embeddings (pgvector) for RAG retrieval
--
-- Purpose:
-- - Store docs chunks (from `/docs` markdown) in Postgres with embeddings
-- - Query nearest chunks via a safe RPC for grounded answers
--
-- Notes:
-- - Uses pgvector extension: `vector`
-- - Embedding dimension defaults to 1536 (OpenAI `text-embedding-3-small`)
-- - Inserts/updates should be done server-side using the service role key.

create extension if not exists vector;

create table if not exists public.sai_doc_chunks (
  id uuid primary key default gen_random_uuid(),
  doc_path text not null,
  chunk_id text not null,
  title text not null,
  content_md text not null,
  content_text text not null,
  tags text[] not null default '{}'::text[],
  sources text[] not null default '{}'::text[],
  content_sha256 text not null,
  embedding vector(1536) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (doc_path, chunk_id)
);

create index if not exists sai_doc_chunks_doc_path_idx
  on public.sai_doc_chunks (doc_path);

-- Vector index (cosine). For small corpora it's optional but still helpful.
create index if not exists sai_doc_chunks_embedding_ivfflat
  on public.sai_doc_chunks using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- Maintain updated_at
create or replace function public.sai_doc_chunks_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists sai_doc_chunks_touch on public.sai_doc_chunks;
create trigger sai_doc_chunks_touch
before update on public.sai_doc_chunks
for each row execute function public.sai_doc_chunks_touch_updated_at();

-- Safe search RPC.
-- Takes float8[] to avoid client type issues; casts to vector(1536).
create or replace function public.sai_docs_search(
  query_embedding float8[],
  match_count int default 5
)
returns table (
  chunk_id text,
  title text,
  content_text text,
  sources text[],
  score double precision
)
language sql
stable
as $$
  select
    c.chunk_id,
    c.title,
    c.content_text,
    c.sources,
    (1 - (c.embedding <=> (query_embedding::vector(1536))))::double precision as score
  from public.sai_doc_chunks c
  where c.doc_path = 'web/src/app/(main-flat)/docs/docs.md'
  order by c.embedding <=> (query_embedding::vector(1536))
  limit greatest(1, least(match_count, 8));
$$;

grant execute on function public.sai_docs_search(float8[], int) to anon, authenticated;

-- RLS: docs are safe, but keep them scoped to authenticated users (app requires auth anyway).
alter table public.sai_doc_chunks enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='sai_doc_chunks' and policyname='sai_doc_chunks_select_authenticated'
  ) then
    create policy sai_doc_chunks_select_authenticated
      on public.sai_doc_chunks
      for select
      to authenticated
      using (true);
  end if;
end $$;

