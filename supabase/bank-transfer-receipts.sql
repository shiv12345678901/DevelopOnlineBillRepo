-- Bank-transfer evidence used by the Settle screen.
-- A settlement step is only shown as verified when a row exists here.
create table if not exists public.bank_transfer_receipts (
  id uuid primary key default gen_random_uuid(),
  period_id text not null references public.periods(id) on delete cascade,
  step_id text not null,
  from_name text not null,
  to_name text not null,
  amount_cents integer not null check (amount_cents > 0),
  transfer_date date not null,
  receipt_url text,
  created_at timestamptz not null default now(),
  unique (period_id, step_id)
);

alter table public.bank_transfer_receipts enable row level security;
grant select on public.bank_transfer_receipts to authenticated;

drop policy if exists "authenticated users read bank transfer receipts" on public.bank_transfer_receipts;
create policy "authenticated users read bank transfer receipts"
on public.bank_transfer_receipts for select to authenticated using (true);
