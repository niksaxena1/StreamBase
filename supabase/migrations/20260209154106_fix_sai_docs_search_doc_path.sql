-- Migration: fix sai_docs_search doc_path filter
--
-- Why:
-- - `/docs` is rendered from `web/src/app/(main-flat)/docs/docs.md`
-- - Earlier versions of `sai_docs_search` filtered on `web/src/app/(main)/docs/docs.md`,
--   which can cause vector retrieval to return 0 rows even after reindexing.
--
-- This migration makes `sai_docs_search` accept chunks indexed under either doc_path
-- (backward-compatible), while keeping the same function signature used by the app.

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
  where c.doc_path in (
    'web/src/app/(main-flat)/docs/docs.md',
    'web/src/app/(main)/docs/docs.md'
  )
  order by c.embedding <=> (query_embedding::vector(1536))
  limit greatest(1, least(match_count, 8));
$$;

grant execute on function public.sai_docs_search(float8[], int) to anon, authenticated;

