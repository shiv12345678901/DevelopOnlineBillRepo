-- Run once in the Supabase SQL editor after creating the four Auth users.
-- The app is a single shared household, so every authenticated member can read it.

alter table public.settlements enable row level security;
alter table public.receipts enable row level security;
alter table public.periods enable row level security;

revoke all on table public.settlements from anon, public;
revoke all on table public.receipts from anon, public;
revoke all on table public.periods from anon, public;

grant select on table public.settlements to authenticated;
grant select on table public.receipts to authenticated;
grant select on table public.periods to authenticated;

drop policy if exists "household members read settlements" on public.settlements;
drop policy if exists "household members read receipts" on public.receipts;
drop policy if exists "household members read periods" on public.periods;

create policy "household members read settlements"
on public.settlements for select to authenticated using (true);

create policy "household members read receipts"
on public.receipts for select to authenticated using (true);

create policy "household members read periods"
on public.periods for select to authenticated using (true);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "members read own avatar" on storage.objects;
drop policy if exists "authenticated members read household avatars" on storage.objects;
drop policy if exists "members upload own avatar" on storage.objects;
drop policy if exists "members update own avatar" on storage.objects;
drop policy if exists "members delete own avatar" on storage.objects;

create policy "members read own avatar"
on storage.objects for select to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- This app has one authenticated household. Allow members to read each
-- other's private avatar objects so settlement rows can show real photos.
create policy "authenticated members read household avatars"
on storage.objects for select to authenticated
using (bucket_id = 'avatars');

create policy "members upload own avatar"
on storage.objects for insert to authenticated
with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "members update own avatar"
on storage.objects for update to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "members delete own avatar"
on storage.objects for delete to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- Expose only the display name and avatar path needed by the viewer. The
-- function reads Auth metadata server-side; raw auth.users is never exposed.
create or replace function public.get_member_avatar_paths()
returns table (member_name text, avatar_path text)
language sql
security definer
set search_path = public, auth
as $$
  select
    m.name as member_name,
    u.raw_user_meta_data ->> 'avatar_path' as avatar_path
  from auth.users u
  join public.members m
    on lower(m.name) = lower(coalesce(u.raw_user_meta_data ->> 'display_name', split_part(u.email, '@', 1)))
    or lower(split_part(m.name, ' ', 1)) = lower(u.raw_user_meta_data ->> 'member_key')
  where coalesce(m.active, true)
    and nullif(u.raw_user_meta_data ->> 'avatar_path', '') is not null;
$$;

revoke all on function public.get_member_avatar_paths() from public;
grant execute on function public.get_member_avatar_paths() to authenticated;

drop policy if exists "authenticated users read bill evidence" on storage.objects;
create policy "authenticated users read bill evidence"
on storage.objects for select to authenticated
using (bucket_id = 'bill-evidence');
