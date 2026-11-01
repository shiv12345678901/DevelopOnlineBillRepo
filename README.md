# Rockdale Homies - Grocery Ledger

Receipt photos in, settlements out. Batch-scan receipts with Gemini vision
(with an on-device Tesseract fallback), review the details, and the app works
out who owes who for each settlement cycle.

Built with React 19 + Vite 8 + Tailwind CSS v4, backed by Supabase.

## Private household access

1. Remove old accounts in Supabase Authentication, then create the four household accounts with the supported Admin API script below.
2. Disable new-user sign-ups so accounts cannot be created from outside the household.
3. Run `supabase/private-access.sql` in the Supabase SQL editor.
4. Enable Passkeys in Supabase Authentication. Use `Bill For Us` as the display name, `billforus.netlify.app` as the RP ID, and `https://billforus.netlify.app` as the RP origin.

The app only provides sign-in. Display names are saved to Supabase Auth metadata.
Profile photos are resized before upload and stored privately in Supabase Storage.

### Create the four accounts once

Supabase does not support creating password users safely with direct SQL inserts into `auth.users`.
Use the server-only Admin API script instead. In PowerShell, set the project URL, a Supabase
secret/service-role key, and the four passwords without putting them in the repository:

```powershell
$env:SUPABASE_URL = "https://YOUR_PROJECT.supabase.co"
$env:SUPABASE_SECRET_KEY = "YOUR_SERVER_ONLY_SECRET_KEY"
$env:SHIVA_PASSWORD = "choose-a-password"
$env:ARPAN_PASSWORD = "choose-a-password"
$env:ARJUN_PASSWORD = "choose-a-password"
$env:SWASTI_PASSWORD = "choose-a-password"
npm run create:household-users
```

This creates `shiva@billforus.netlify.app`, `arpan@billforus.netlify.app`,
`arjun@billforus.netlify.app`, and `swasti@billforus.netlify.app` with confirmed emails.
Delete or clear the password environment variables after the script finishes. Never expose the
secret/service-role key in browser code.

## Receipt scanning workflow

1. **Snap** - pick one or many receipt photos (camera or gallery).
2. **Crop** - each receipt gets a crop pass so only the important part is read.
3. **Scan** - the image goes to Gemini vision first; if the API is down,
   unreliable, or unsure, the same image is OCR'd on-device with Tesseract.js.
   If both fail, the amount field is left empty for manual entry.
4. **Review** - every receipt shows its engine (AI / on-device), the parsed
   total, merchant, payer, date and a confidence flag when low.
5. **Save** - confirmed receipts are written to Supabase and the balances
   update instantly.

## Run locally

1. **Supabase** - create a project, then run `supabase/schema.sql` (from the
   sibling project or the SQL below) in the SQL Editor:

   ```sql
   create table if not exists settlement_cycles (
     id bigint generated always as identity primary key,
     name text not null,
     members text[] not null default '{}',
     starts_on date not null default current_date,
     ends_on date,
     created_at timestamptz default now()
   );
   create table if not exists grocery_ledger (
     id bigint generated always as identity primary key,
     cycle_id bigint not null references settlement_cycles(id) on delete cascade,
     payer text not null,
     amount decimal(10, 2) not null,
     currency text default 'INR',
     note text,
     merchant text,
     ai_confidence numeric(3, 2),
     spent_on date not null default current_date,
     created_at timestamptz default now()
   );
   alter table settlement_cycles enable row level security;
   alter table grocery_ledger enable row level security;
   create policy "anon all cycles" on settlement_cycles for all to anon using (true) with check (true);
   create policy "anon all ledger" on grocery_ledger for all to anon using (true) with check (true);
   ```

2. **Supabase keys** - `src/utils/supabase/info.tsx` holds the project id and
   anon key. Replace them with your own project's values.

3. **Gemini key** - get one at <https://aistudio.google.com>, then:

   ```bash
   cp .env.local.example .env.local
   # edit .env.local and paste your key(s)
   ```

4. **Run**:

   ```bash
   npm install
   npm run dev
   ```

   The app runs at `http://localhost:8443` (set `PORT` to change it).

## Deploy

The repo includes `netlify.toml`. Import it into Netlify and set the same
`GEMINI_*` environment variables. The `/api/ocr` route automatically maps to
the serverless function in `netlify/functions/`.

### On-demand InstaBox wake-up

`Sync now` calls the same-origin `/api/sync` Netlify function. The function verifies the
Supabase access token and the four-account household allowlist, then uses that user's
RLS-scoped Supabase client to create or reuse a pending `sync_requests` row. It never uses
a Supabase service-role key. InstaBox credentials and the target machine are accepted only
from Netlify's server environment; there is no browser proxy or client-selectable machine ID.

Before deployment, review and apply `supabase/instabox-wake-dedup.sql`. It validates the
verified production contract (`sync_requests.id` UUID plus text `requested_by`/`status` and
`created_at` timestamptz), aborts if multiple active jobs need manual review, and adds only a
partial unique index. Existing RLS policies and grants are not changed.

Configure these values in **Netlify → Site configuration → Environment variables** for the
Functions runtime, never as `VITE_*` variables:

```text
SUPABASE_URL=https://oisbygwncnperuxfkvfd.supabase.co
SUPABASE_ANON_KEY=<the public anon key used by this project>
INSTABOX_API_KEY=<server-only key with machines:read and machines:write scopes>
INSTABOX_MACHINE_ID=<the fixed m_... machine ID>
```

The function reads machine state, uses `resume` for a suspended machine and `start` for a
stopped machine, and follows the returned operation briefly. Lifecycle calls carry stable,
bounded idempotency keys. Retryable failures and cooldowns leave the Supabase request pending
so the existing Muse worker can still process it. The frontend continues polling Supabase and
never treats wake acceptance as job completion.

The implementation is limited to InstaBox's documented lifecycle surface:
`GET /v1/machines/{id}`, `POST /v1/machines/{id}/resume`,
`POST /v1/machines/{id}/start`, and `GET /v1/operations/{id}?wait=8s`.

This integration does not authorize the InstaBox worker's production database writes. Keep
that worker disabled and leave Muse active until the separate handover is approved.

## Notes

- Amounts are shown in **AUD** by default (change `currency: "AUD"` and the
  `en-AU` locale strings in `src/App.tsx` if you prefer something else).
- Free-tier Gemini requests may be used by Google to improve their products;
  the on-device fallback keeps working even if the key is removed entirely.
- Low-confidence totals are flagged for manual confirmation before saving.

-- Receipt images (run once in Supabase SQL Editor)
alter table grocery_ledger add column if not exists receipt_image text;
