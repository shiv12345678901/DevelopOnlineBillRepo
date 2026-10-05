# Rockdale Homies - Grocery Ledger

Receipt photos in, settlements out. Batch-scan receipts with Gemini vision
(with an on-device Tesseract fallback), review the details, and the app works
out who owes who for each settlement cycle.

Built with React 19 + Vite 8 + Tailwind CSS v4, backed by Supabase.

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

## Notes

- Amounts are shown in **AUD** by default (change `currency: "AUD"` and the
  `en-AU` locale strings in `src/App.tsx` if you prefer something else).
- Free-tier Gemini requests may be used by Google to improve their products;
  the on-device fallback keeps working even if the key is removed entirely.
- Low-confidence totals are flagged for manual confirmation before saving.
