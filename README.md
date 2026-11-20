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

## How P&L is stored

- `pnl` = gross realized P&L, `fees` = fees paid. Every stat uses **net = pnl − fees**.
- If an export's P&L already has fees taken out, tick the checkbox on the Import page.

## CSV import

- **Hyperliquid** — Portfolio → Trade History → Export as CSV. Rows are fills; Tidemark groups them into complete trades (handles partial closes and long/short flips). Spot fills and still-open positions are skipped.
- **Bitunix** — Futures → Position History → Export. Columns are matched by common names; if something isn't recognized, the importer lists the headers it found.
- Re-importing the same file skips duplicates.

## Deploying to GitHub Pages

`vite.config.ts` sets `base: '/trade-journal/'`. Run `npm run build` and publish the `dist/` folder.
The anon key is designed to be public; your data is protected by the RLS policy.
Also add your Pages URL under **Supabase → Authentication → URL Configuration** so email confirmation links work.
