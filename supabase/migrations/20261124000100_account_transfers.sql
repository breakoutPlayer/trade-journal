-- Settings → Accounts: deposits (amount > 0) and withdrawals (amount < 0) per account.
create table if not exists public.account_transfers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_key text not null check (length(trim(account_key)) between 1 and 120),
  amount numeric not null check (amount <> 0),
  at timestamptz not null default now(),
  note text check (note is null or length(note) <= 200),
  created_at timestamptz not null default now()
);
create index if not exists account_transfers_user_idx on public.account_transfers (user_id, account_key, at);

alter table public.account_transfers enable row level security;
drop policy if exists "own rows" on public.account_transfers;
create policy "own rows" on public.account_transfers
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
revoke all on public.account_transfers from anon;
grant select, insert, update, delete on public.account_transfers to authenticated;
