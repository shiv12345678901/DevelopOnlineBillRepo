-- Receipt image storage — run ONCE in the Supabase SQL Editor.
-- Creates a public "receipts" bucket and lets the app upload to it.

insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', true)
on conflict (id) do update set public = true;

-- Allow the app (anon key) to upload and replace receipt images.
create policy "anon upload receipts"
  on storage.objects for insert to anon
  with check (bucket_id = 'receipts');

-- Public buckets are world-readable via /object/public/ already; this policy
-- is belt-and-braces for signed-URL style reads.
create policy "anon read receipts"
  on storage.objects for select to anon
  using (bucket_id = 'receipts');
