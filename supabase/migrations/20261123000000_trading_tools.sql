-- Settings → Trading Tools & Strategies: setups, mistakes, custom tag categories, strategies.

-- Setup and mistake definitions (name + color). Trades keep storing names in `tags` / `mistakes`.
create table if not exists public.trade_labels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('setup', 'mistake')),
  name text not null check (length(trim(name)) between 1 and 60),
  color text not null default '#3fd0b0',
  created_at timestamptz not null default now(),
  unique (user_id, kind, name)
);

-- Custom tag categories, e.g. "Timeframe" with tags ["15m - 5m", "4h - 1h"].
-- Trades store chosen tags in `custom_tags` as "Category: tag".
create table if not exists public.tag_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 40 and position(':' in name) = 0),
  color text not null default '#7c8cff',
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

-- Strategies: a playbook with rules; a trade can follow one.
create table if not exists public.strategies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  description text,
  rules text[] not null default '{}',
  color text not null default '#f5b14c',
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

alter table public.trades add column if not exists custom_tags text[];
alter table public.trades add column if not exists strategy_id uuid references public.strategies (id) on delete set null;

-- RLS: each user sees and edits only their own rows.
do $$
declare t text;
begin
  foreach t in array array['trade_labels', 'tag_categories', 'strategies'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('create policy "own rows" on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- Rename or remove a value across the caller's trades. new_value null = remove.
-- Runs as the caller (security invoker), so RLS limits it to their own trades.
create or replace function public.rename_trade_value(col text, old_value text, new_value text)
returns integer language plpgsql security invoker set search_path = public as $$
declare n integer;
begin
  if col not in ('tags', 'mistakes', 'custom_tags') then raise exception 'bad column'; end if;
  if new_value is null then
    execute format('update public.trades set %1$I = array_remove(%1$I, $1) where user_id = auth.uid() and $1 = any(%1$I)', col) using old_value;
  else
    -- replace, then drop any duplicate that the rename created
    execute format('update public.trades set %1$I = (select array_agg(distinct v order by v) from unnest(array_replace(%1$I, $1, $2)) v) where user_id = auth.uid() and $1 = any(%1$I)', col) using old_value, new_value;
  end if;
  get diagnostics n = row_count;
  return n;
end $$;

-- Rename (new_name) or remove (null) a whole custom-tag category on the caller's trades.
create or replace function public.rename_tag_category(old_name text, new_name text)
returns integer language plpgsql security invoker set search_path = public as $$
declare n integer;
begin
  update public.trades t set custom_tags = (
    select coalesce(array_agg(case when new_name is null then null else new_name || substr(v, length(old_name) + 1) end), '{}')
    from unnest(t.custom_tags) v where left(v, length(old_name) + 2) = old_name || ': ' and new_name is not null
  ) || (select coalesce(array_agg(v), '{}') from unnest(t.custom_tags) v where left(v, length(old_name) + 2) <> old_name || ': ')
  where user_id = auth.uid() and exists (select 1 from unnest(t.custom_tags) v where left(v, length(old_name) + 2) = old_name || ': ');
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.rename_trade_value(text, text, text) from public, anon;
revoke all on function public.rename_tag_category(text, text) from public, anon;
grant execute on function public.rename_trade_value(text, text, text) to authenticated;
grant execute on function public.rename_tag_category(text, text) to authenticated;
