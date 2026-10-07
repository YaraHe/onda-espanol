-- Stage 3 Task 4: per-user listening preferences. Apply once after the Stage 1 migration.
-- Existing user_settings rows receive defaults; lang and existing RLS policies are unchanged.

alter table public.user_settings
  add column listening_scope text not null default 'all'
    check (listening_scope in ('learned', 'all', 'custom')),
  add column listening_rate real not null default 1.0
    check (listening_rate between 0.6 and 1.2),
  add column listening_interval_seconds smallint not null default 2
    check (listening_interval_seconds in (1, 2, 4)),
  add column listening_show_text boolean not null default true,
  add column listening_show_translation boolean not null default false,
  add column listening_custom_selection text[] not null default '{}';
