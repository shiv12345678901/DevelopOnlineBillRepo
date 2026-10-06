-- Receipt image storage — run ONCE in the Supabase SQL Editor.
-- Covers both buckets used by the app:
--   "receipts"          — legacy main-scanner uploads
--   "grocery-receipts"  — the WhatsApp-import image library (your 371 files)

insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', true)
on conflict (id) do update set public = true;

insert into storage.buckets (id, name, public)
values ('grocery-receipts', 'grocery-receipts', true)
on conflict (id) do update set public = true;

-- Allow the app (anon key) to upload receipt images.
create policy "anon upload receipts"
  on storage.objects for insert to anon
  with check (bucket_id in ('receipts', 'grocery-receipts'));

create policy "anon upload grocery-receipts"
  on storage.objects for insert to anon
  with check (bucket_id = 'grocery-receipts');

-- Public buckets are world-readable via /object/public/ already; these
-- policies are belt-and-braces for list/read access.
create policy "anon read receipts"
  on storage.objects for select to anon
  using (bucket_id in ('receipts', 'grocery-receipts'));

create policy "anon read grocery-receipts"
  on storage.objects for select to anon
  using (bucket_id = 'grocery-receipts');
