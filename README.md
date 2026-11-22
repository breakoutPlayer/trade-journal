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

## How P&L is stored

- `pnl` = gross realized P&L, `fees` = fees paid. Every stat uses **net = pnl − fees**.
- If an export's P&L already has fees taken out, tick the checkbox on the Import page.

## CSV import

- **Hyperliquid** — Portfolio → Trade History → Export as CSV. Rows are fills; Tidemark groups them into complete trades (handles partial closes and long/short flips). Spot fills and still-open positions are skipped.
- **Bitunix** — Futures → Position History → Export. Columns are matched by common names; if something isn't recognized, the importer lists the headers it found.
- Re-importing the same file skips duplicates.

## Deploying to GitHub Pages

`vite.config.ts` sets `base: '/trade-journal/'`. The workflow in `.github/workflows/deploy.yml` builds and deploys on every push to `main`.

One-time setup on GitHub:
1. **Settings → Secrets and variables → Actions**: add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
2. **Settings → Pages → Source**: choose **GitHub Actions**.
The anon key is designed to be public; your data is protected by the RLS policy.
Also add your Pages URL under **Supabase → Authentication → URL Configuration** so email confirmation links work.
