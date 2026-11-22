-- Exchange auto-sync: connections, encrypted secrets, sync history, and trade columns.
-- Safe to run more than once.

-- 1) Trades: where a synced row came from.
alter table public.trades add column if not exists external_id text;
alter table public.trades add column if not exists account text;
create unique index if not exists trades_external_uniq
  on public.trades (user_id, exchange, account, external_id);
-- NULL external_id values never collide in a unique index, so manual/CSV rows are unaffected.

-- 2) Connections (metadata only; the browser can read these).
create table if not exists public.exchange_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  exchange text not null check (exchange in ('bitunix', 'binance', 'okx')),
  label text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  last_synced_at timestamptz,
  last_status text,          -- 'ok' | 'error' | 'running'
  last_error text,
  last_new_count int,
  unique (user_id, exchange, label)
);
alter table public.exchange_connections enable row level security;
drop policy if exists "own connections read" on public.exchange_connections;
create policy "own connections read" on public.exchange_connections
  for select using (auth.uid() = user_id);
drop policy if exists "own connections update" on public.exchange_connections;
create policy "own connections update" on public.exchange_connections
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- Inserts and deletes go through the `connections` Edge Function (service role).
-- Only `enabled` may be changed from the browser:
revoke update on public.exchange_connections from anon, authenticated;
grant update (enabled) on public.exchange_connections to authenticated;

-- 3) Encrypted API secrets. RLS on with NO policies: only the service role can read/write.
create table if not exists public.exchange_secrets (
  connection_id uuid primary key references public.exchange_connections (id) on delete cascade,
  ciphertext text not null,
  iv text not null
);
alter table public.exchange_secrets enable row level security;
revoke all on public.exchange_secrets from anon, authenticated;

-- Browser may only read connections and toggle `enabled`; inserts/deletes go through the Edge Function.
revoke insert, delete, truncate, references, trigger on public.exchange_connections from anon, authenticated;
revoke all on public.exchange_connections from anon;

-- 4) Rate limits for key checks and manual syncs. Service role only.
create table if not exists public.rate_limits (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  action text not null,
  at timestamptz not null default now()
);
create index if not exists rate_limits_lookup on public.rate_limits (user_id, action, at desc);
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;

-- 5) Sync history.
create table if not exists public.sync_runs (
  id bigint generated always as identity primary key,
  connection_id uuid not null references public.exchange_connections (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null,
  new_count int not null default 0,
  error text
);
create index if not exists sync_runs_conn_idx on public.sync_runs (connection_id, started_at desc);
alter table public.sync_runs enable row level security;
drop policy if exists "own sync runs read" on public.sync_runs;
create policy "own sync runs read" on public.sync_runs
  for select using (auth.uid() = user_id);
revoke all on public.sync_runs from anon;
revoke insert, update, delete, truncate, references, trigger on public.sync_runs from authenticated;
-- Note: identity columns need no sequence grants for the browser, which never inserts here.
