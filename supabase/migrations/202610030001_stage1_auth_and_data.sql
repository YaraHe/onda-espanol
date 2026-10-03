-- Stage 1 Task 3: schema from docs/05-DATABASE.md and owner-only access.
-- Apply once in the Supabase project SQL Editor before testing registration.

create table public.profiles (
  id uuid primary key references auth.users(id),
  nickname text,
  created_at timestamptz default now()
);

create table public.practice_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  sentence text not null,
  translation text,
  overall real,
  accuracy real,
  fluency real,
  completeness real,
  speaking_rate real,
  raw_feedback jsonb,
  created_at timestamptz default now()
);

create table public.user_settings (
  user_id uuid primary key references auth.users(id),
  lang text default 'es-ES',
  updated_at timestamptz default now()
);

alter table public.profiles enable row level security;
alter table public.practice_records enable row level security;
alter table public.user_settings enable row level security;

-- Start from explicit browser privileges; anonymous requests get no table access.
revoke all on public.profiles, public.practice_records, public.user_settings
  from public, anon, authenticated;

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.practice_records to authenticated;
grant select, insert, update on public.user_settings to authenticated;

create policy "profiles_select_own" on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id);

create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "practice_records_select_own" on public.practice_records
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "practice_records_insert_own" on public.practice_records
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "practice_records_update_own" on public.practice_records
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "practice_records_delete_own" on public.practice_records
  for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "user_settings_select_own" on public.user_settings
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "user_settings_insert_own" on public.user_settings
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "user_settings_update_own" on public.user_settings
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Signup metadata carries the nickname entered on the registration form.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, nickname)
  values (new.id, new.raw_user_meta_data ->> 'nickname');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- A Stage 0 Auth test may already have created a user before this migration.
insert into public.profiles (id, nickname)
select id, raw_user_meta_data ->> 'nickname'
from auth.users
on conflict (id) do nothing;
