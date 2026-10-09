-- Stage 4.1: independent, per-user personal sentence collection.
-- Apply after the Stage 1 and Stage 3 migrations in an isolated project first.

create table public.personal_sentences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  sentence text not null check (length(btrim(sentence)) > 0),
  translation text,
  identity_key text not null check (length(identity_key) > 0),
  created_at timestamptz not null default now(),
  constraint personal_sentences_user_identity_key unique (user_id, identity_key)
);

create index practice_records_user_history_idx
  on public.practice_records (user_id, created_at desc, id desc);

alter table public.personal_sentences enable row level security;

revoke all on public.personal_sentences from public, anon, authenticated;
grant select, insert, update, delete on public.personal_sentences to authenticated;

create policy "personal_sentences_select_own" on public.personal_sentences
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "personal_sentences_insert_own" on public.personal_sentences
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "personal_sentences_update_own" on public.personal_sentences
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "personal_sentences_delete_own" on public.personal_sentences
  for delete to authenticated
  using ((select auth.uid()) = user_id);
