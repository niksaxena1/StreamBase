-- Migration: SAI (SpotiBase AI) conversations + messages
-- Run this in your Supabase SQL editor.
--
-- Goals:
-- - Store chat history per authenticated user
-- - Support "new chat" server-side purge (soft delete + optional hard delete messages)
-- - Enable reliable citations/tool metadata storage
--
-- Notes:
-- - Uses auth.uid() for RLS.
-- - The API routes may write using either service role or user session;
--   RLS ensures users can only see their own data.

create table if not exists public.sai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  title text null
);

create index if not exists sai_conversations_user_created_idx
  on public.sai_conversations (user_id, created_at desc);

create table if not exists public.sai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.sai_conversations(id) on delete cascade,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  role text not null check (role in ('user','assistant','system','tool')),
  content text not null default '',
  -- Optional structured payloads:
  -- - context envelope captured at send-time
  -- - retrieval citations (doc chunk ids, titles, scores)
  -- - tool calls (template id, params, row counts)
  meta jsonb not null default '{}'::jsonb
);

create index if not exists sai_messages_conversation_created_idx
  on public.sai_messages (conversation_id, created_at asc);

create index if not exists sai_messages_user_created_idx
  on public.sai_messages (user_id, created_at desc);

-- Keep updated_at current (best-effort)
create or replace function public.sai_touch_conversation_updated_at()
returns trigger
language plpgsql
as $$
begin
  update public.sai_conversations
     set updated_at = now()
   where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists sai_messages_touch_conversation on public.sai_messages;
create trigger sai_messages_touch_conversation
after insert on public.sai_messages
for each row execute function public.sai_touch_conversation_updated_at();

-- RLS
alter table public.sai_conversations enable row level security;
alter table public.sai_messages enable row level security;

-- Conversations policies
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='sai_conversations' and policyname='sai_conversations_select_own'
  ) then
    create policy sai_conversations_select_own
      on public.sai_conversations
      for select
      to authenticated
      using (user_id = auth.uid() and deleted_at is null);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='sai_conversations' and policyname='sai_conversations_insert_own'
  ) then
    create policy sai_conversations_insert_own
      on public.sai_conversations
      for insert
      to authenticated
      with check (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='sai_conversations' and policyname='sai_conversations_update_own'
  ) then
    create policy sai_conversations_update_own
      on public.sai_conversations
      for update
      to authenticated
      using (user_id = auth.uid())
      with check (user_id = auth.uid());
  end if;
end $$;

-- Messages policies
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='sai_messages' and policyname='sai_messages_select_own'
  ) then
    create policy sai_messages_select_own
      on public.sai_messages
      for select
      to authenticated
      using (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='sai_messages' and policyname='sai_messages_insert_own'
  ) then
    create policy sai_messages_insert_own
      on public.sai_messages
      for insert
      to authenticated
      with check (user_id = auth.uid());
  end if;
end $$;

