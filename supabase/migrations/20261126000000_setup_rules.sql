-- Trading rules: each setup has a Bias checklist and an Entry checklist; each trade keeps its review.

-- Rule lists on setups: [{ "id": "...", "text": "..." }, ...] in display order.
alter table public.trade_labels add column if not exists bias_rules jsonb not null default '[]'::jsonb;
alter table public.trade_labels add column if not exists entry_rules jsonb not null default '[]'::jsonb;

-- Review on a trade: { "setup": "Bounce", "bias": [{id,text,ok}], "entry": [{id,text,ok}], "reviewed_at": "..." | null }.
-- A reviewed trade keeps this copy of the rules, so later edits in Settings don't change old scores.
alter table public.trades add column if not exists rule_review jsonb;

-- Same as before, plus: renaming a setup renames it on reviews; deleting a setup removes its reviews.
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
  if col = 'tags' then
    update public.trades
    set rule_review = case when new_value is null then null else jsonb_set(rule_review, '{setup}', to_jsonb(new_value)) end
    where user_id = auth.uid() and rule_review ->> 'setup' = old_value;
  end if;
  return n;
end $$;

revoke all on function public.rename_trade_value(text, text, text) from public, anon;
grant execute on function public.rename_trade_value(text, text, text) to authenticated;
