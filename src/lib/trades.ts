import { supabase } from './supabase'
import type { Trade, TradeInput } from './types'

const PAGE = 1000 // Supabase returns at most 1000 rows per request

export async function fetchTrades(): Promise<Trade[]> {
  const all: Trade[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('trades')
      .select('*')
      .order('closed_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .range(from, from + PAGE - 1)
    if (error) throw error
    all.push(...(data as Trade[]))
    if (data.length < PAGE) return all
  }
}

export async function insertTrades(rows: TradeInput[]) {
  // Insert in chunks so big CSV imports don't hit request size limits.
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from('trades').insert(rows.slice(i, i + 500))
    if (error) throw error
  }
}

export async function updateTrade(id: string, row: Partial<TradeInput>) {
  const { error } = await supabase.from('trades').update(row).eq('id', id)
  if (error) throw error
}

export async function deleteTrade(id: string) {
  const { error } = await supabase.from('trades').delete().eq('id', id)
  if (error) throw error
}

/** Net P&L = gross P&L minus fees. */
export function netPnl(t: Pick<Trade, 'pnl' | 'fees'>) {
  return (Number(t.pnl) || 0) - (Number(t.fees) || 0)
}

/** Net P&L as a fraction of the position's cost (entry × size), or null when unknown. */
export function tradeReturn(t: Trade) {
  const cost = Math.abs((Number(t.entry_price) || 0) * (Number(t.size) || 0))
  return cost ? netPnl(t) / cost : null
}

export type TradeStatus = 'WIN' | 'LOSS' | 'BE' | 'OPEN'
export function tradeStatus(t: Trade): TradeStatus {
  if (!t.closed_at && t.exit_price == null && t.pnl == null) return 'OPEN'
  const n = netPnl(t)
  return n > 0 ? 'WIN' : n < 0 ? 'LOSS' : 'BE'
}

/** Turns "column does not exist" errors for the newer columns into a pointer at the README SQL. */
export function friendlySaveError(err: unknown) {
  const msg = (err as Error)?.message ?? String(err)
  return /mistakes|targets|stops/.test(msg) && /column|schema cache/i.test(msg)
    ? 'Your trades table is missing the mistakes/targets/stops columns. Run the SQL under "Trade details" in the README once in the Supabase SQL Editor.'
    : msg
}

/** The moment a trade "counts": when it closed, else when it opened, else when it was logged. */
export function tradeTime(t: Pick<Trade, 'closed_at' | 'opened_at' | 'created_at'>) {
  return new Date(t.closed_at ?? t.opened_at ?? t.created_at)
}

/** Local calendar date key, e.g. 2026-11-21. */
export function dayKey(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
