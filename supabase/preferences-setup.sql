-- User preferences — run ONCE in the Supabase SQL Editor.
-- Stores per-device app state (active cycle, theme) in the database so the
-- experience follows the user across reloads and devices sharing a login.

create table if not exists user_preferences (
  id text primary key,                          -- device id (uuid, generated app-side)
  active_cycle_id bigint,                       -- references settlement_cycles(id) logically
  theme text not null default 'auto',           -- 'auto' | 'light' | 'dark'
  household_name text,                          -- display name, falls back to the app default
  updated_at timestamptz not null default now()
);

-- Safe to re-run if the table predates this column.
alter table user_preferences add column if not exists household_name text;

alter table user_preferences enable row level security;

-- The app is anon-authenticated; each device row is created and updated by
-- the same anon key, so a permissive policy is the pragmatic choice here
-- (same trust model as the ledger tables).
drop policy if exists "anon manage own preferences" on user_preferences;
create policy "anon manage own preferences"
  on user_preferences for all to anon
  using (true)
  with check (true);
