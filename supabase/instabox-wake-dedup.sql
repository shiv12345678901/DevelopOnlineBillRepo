-- Apply only after checking there is at most one pending/processing netlify-app job.
-- This does not change grants or RLS policies. It makes concurrent Netlify
-- function instances converge on one active sync request.
begin;
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='sync_requests' and column_name='id' and data_type='uuid')
    or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='sync_requests' and column_name='requested_by' and data_type='text')
    or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='sync_requests' and column_name='status' and data_type='text')
    or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='sync_requests' and column_name='created_at' and data_type='timestamp with time zone') then
    raise exception 'sync_requests does not match the verified frontend contract';
  end if;
  if (select count(*) from public.sync_requests where requested_by='netlify-app' and status in ('pending','processing')) > 1 then
    raise exception 'Multiple active sync requests require manual review; no rows were changed';
  end if;
end $$;
create unique index if not exists sync_requests_one_active_netlify_job
  on public.sync_requests ((requested_by))
  where requested_by='netlify-app' and status in ('pending','processing');
commit;
