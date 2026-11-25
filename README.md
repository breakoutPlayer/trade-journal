# Tidemark

A personal trading journal: import trades from Hyperliquid or Bitunix, log notes and tags, and see your win rate, profit factor, equity curve, P&L calendar, and breakdowns by pair, weekday, and tag.

Built with React, Vite, TypeScript, and Supabase (auth + Postgres with row-level security).

## Setup

1. Create the `trades` table in Supabase (SQL Editor) with RLS enabled and an "own trades only" policy on `auth.uid() = user_id`.
2. Copy `.env.example` to `.env.local` and fill in values from **Supabase → Project Settings → API**:
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=...
   ```
   `.env.local` is git-ignored.
3. Install and run:
   ```
   npm install
   npm run dev
   ```
   Open http://localhost:5173/trade-journal/

## Chart screenshots

Trades can have chart images attached (upload, drag-and-drop, or paste a screenshot with Ctrl+V in the trade form). Files go to a private Supabase Storage bucket at `charts/<user_id>/…`; the trade's `charts` column holds their paths. Run this once in the SQL Editor:

```sql
alter table trades add column if not exists charts text[] not null default '{}';

insert into storage.buckets (id, name, public)
values ('charts', 'charts', false)
on conflict (id) do nothing;

create policy "own charts: read" on storage.objects for select to authenticated
  using (bucket_id = 'charts' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own charts: upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'charts' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own charts: delete" on storage.objects for delete to authenticated
  using (bucket_id = 'charts' and (storage.foldername(name))[1] = auth.uid()::text);
```

Images are limited to 10 MB each. The JSON backup includes chart paths but not the image files themselves.

## Trade details

Click a trade on the Trades page to open it: Overview, Strategy, Risk and Notes tabs on the left and its chart screenshots on the right (paste a screenshot anywhere on that page to attach it). Setups use the existing `tags` column. Mistakes, profit targets and stop losses need three more columns. Run this once in the SQL Editor:

```sql
alter table trades add column if not exists mistakes text[] not null default '{}';
alter table trades add column if not exists targets numeric[] not null default '{}';
alter table trades add column if not exists stops numeric[] not null default '{}';
```

Note templates ("Save as new template" in the Notes tab) are kept in your browser, not in Supabase.

### Trading rules

Each setup can have a Bias checklist and an Entry checklist (Settings → Setups → Rules). On a trade's Overview tab, pick its setup, tick the rules you followed and press **Mark reviewed**. A reviewed trade keeps the rules it was reviewed with, so editing rules later doesn't change old scores. "Followed" means every rule was ticked. The Trades list shows each trade's score and can filter to trades not yet reviewed, and Reports → Trading rules compares results when rules were followed or not, overall and per rule.

This needs `supabase/migrations/20261126000000_setup_rules.sql` (`npx supabase db push --remote`, or paste it into the SQL Editor).

## Journal

The Journal page has Daily notes (one per trading day, shown with that day's stats and trades), Trade notes (every trade that has notes) and General notes. Daily and general notes live in their own table. Run this once in the SQL Editor:

```sql
create table if not exists journal_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  kind text not null check (kind in ('daily', 'general')),
  day date,
  title text,
  body text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, kind, day)
);
alter table journal_notes enable row level security;
create policy "own journal notes" on journal_notes for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

## How P&L is stored

- `pnl` = gross realized P&L, `fees` = fees paid. Every stat uses **net = pnl − fees**.
- If an export's P&L already has fees taken out, tick the checkbox on the Import page.

## CSV import

- **Hyperliquid** — Portfolio → Trade History → Export as CSV. Rows are fills; Tidemark groups them into complete trades (handles partial closes and long/short flips). Spot fills and still-open positions are skipped.
- **Bitunix** — Futures → Position History → Export. Columns are matched by common names; if something isn't recognized, the importer lists the headers it found.
- Re-importing the same file skips duplicates.

## Exchange auto-sync (Bitunix, Binance, OKX)

The **Connections** tab pulls closed trades automatically (hourly, plus a "Sync now" button). Supported: Bitunix futures, Binance USDT-M futures, OKX perpetual swaps. The first sync backfills 90 days.

**Security model**
- API keys are sent once to the `connections` Edge Function, checked, encrypted with AES-GCM (`ENCRYPTION_KEY` function secret) and stored in `exchange_secrets`, a table the browser can never read (RLS on, no policies). They are never returned to the page, logged, or committed.
- Only **read-only** keys are accepted. Binance and OKX keys with trading, transfer or withdrawal permission are rejected. Bitunix can't report permissions, so you must tick a confirmation box — create the key with trading and withdrawals **off**.
- IP whitelisting isn't used because Supabase Edge Function IPs change; read-only permission is the protection.
- Removing a connection deletes its key and keeps its trades. Trades already imported by CSV aren't duplicated.

**One-time setup** (PowerShell, in the project folder):
1. `npx supabase login`, then `npx supabase link --project-ref <your-project-ref>`.
2. Generate two secrets and store them as function secrets (don't commit them):
   ```powershell
   $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
   $b = New-Object byte[] 32; $rng.GetBytes($b); $enc = [Convert]::ToBase64String($b)
   $c = New-Object byte[] 32; $rng.GetBytes($c); $cron = -join ($c | % { $_.ToString('x2') })
   npx supabase secrets set ENCRYPTION_KEY=$enc CRON_SECRET=$cron
   ```
   Optionally also `npx supabase secrets set ALLOWED_ORIGIN=https://<you>.github.io` to restrict which site may call the functions.
   Keep `ENCRYPTION_KEY` backed up somewhere private: if it's lost, re-add your connections.
3. `npx supabase db push --remote` (runs `supabase/migrations` on your linked project; without `--remote` newer CLI versions target a local database). Or paste `20261122000000_exchange_sync.sql` into the SQL Editor.
4. Deploy the functions (`sync` verifies the user itself so the hourly cron can call it):
   ```powershell
   npx supabase functions deploy connections
   npx supabase functions deploy sync --no-verify-jwt
   ```
5. Hourly schedule: in the SQL Editor, create two Vault secrets — `project_url` (`https://<ref>.supabase.co`) and `cron_secret` (the same `CRON_SECRET`) — `db push` already applied `20261122000100_sync_cron.sql`; the hourly job simply fails until both Vault secrets exist. Check runs under **Integrations → Cron**.

**Adding another exchange:** write an adapter in `supabase/functions/_shared/exchanges/`, register it in `index.ts`, add its id to the `exchange` check in the migration and to `src/lib/connections.ts`.

## Deploying to GitHub Pages

`vite.config.ts` sets `base: '/trade-journal/'`. The workflow in `.github/workflows/deploy.yml` builds and deploys on every push to `main`.

One-time setup on GitHub:
1. **Settings → Secrets and variables → Actions**: add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
2. **Settings → Pages → Source**: choose **GitHub Actions**.
The anon key is designed to be public; your data is protected by the RLS policy.
Also add your Pages URL under **Supabase → Authentication → URL Configuration** so email confirmation links work.
