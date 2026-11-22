-- Settings → Accounts: starting balance per account.
-- account_key matches how the app names accounts: "Bitunix · Main" for synced trades,
-- the exchange name for manual/CSV trades, or "No account".
create table if not exists public.account_balances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_key text not null check (length(trim(account_key)) between 1 and 120),
  starting_balance numeric not null check (starting_balance > 0),
  updated_at timestamptz not null default now(),
  unique (user_id, account_key)
);

alter table public.account_balances enable row level security;
drop policy if exists "own rows" on public.account_balances;
create policy "own rows" on public.account_balances
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
revoke all on public.account_balances from anon;
grant select, insert, update, delete on public.account_balances to authenticated;
