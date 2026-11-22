import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { Trade } from './types'

/** "Bitunix · Main" for synced trades, the exchange for manual/CSV trades, else "No account". */
export function accountOf(t: Pick<Trade, 'exchange' | 'account'>) {
  const ex = t.exchange?.trim()
  if (t.account) return `${ex || 'Unknown'} · ${t.account}`
  return ex || 'No account'
}

/** A deposit (amount > 0) or withdrawal (amount < 0). */
export interface Transfer { id: string; account_key: string; amount: number; at: string; note: string | null }

/**
 * Starting balance per account key, plus deposits/withdrawals.
 * See supabase/migrations/20261124000000_account_balances.sql and 20261124000100_account_transfers.sql.
 */
export function useAccountBalances() {
  const [balances, setBalances] = useState<Record<string, number>>({})
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [error, setError] = useState('')
  const reload = useCallback(() => {
    Promise.all([
      supabase.from('account_balances').select('account_key,starting_balance'),
      supabase.from('account_transfers').select('id,account_key,amount,at,note').order('at', { ascending: false }),
    ]).then(([b, t]) => {
      const e = b.error ?? t.error
      if (e) {
        setError(/does not exist|schema cache/i.test(e.message) ? 'Account tables are missing. Run the account migrations in supabase/migrations.' : e.message)
        return
      }
      setError('')
      setBalances(Object.fromEntries((b.data ?? []).map((r) => [r.account_key, Number(r.starting_balance)])))
      setTransfers((t.data ?? []).map((r) => ({ ...r, amount: Number(r.amount) })) as Transfer[])
    })
  }, [])
  useEffect(reload, [reload])
  return { balances, transfers, error, reload }
}

/** Sum of deposits minus withdrawals per account key. */
export function transferTotals(transfers: Transfer[]) {
  const m: Record<string, number> = {}
  for (const t of transfers) m[t.account_key] = (m[t.account_key] ?? 0) + t.amount
  return m
}

export async function addTransfer(accountKey: string, amount: number, at: Date, note: string) {
  const { error } = await supabase.from('account_transfers').insert({ account_key: accountKey, amount, at: at.toISOString(), note: note.trim() || null })
  if (error) throw new Error(error.message)
}

export async function deleteTransfer(id: string) {
  const { error } = await supabase.from('account_transfers').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/** Sets (amount > 0) or clears (null) an account's starting balance. */
export async function saveBalance(accountKey: string, amount: number | null) {
  const res = amount == null
    ? await supabase.from('account_balances').delete().eq('account_key', accountKey)
    : await supabase.from('account_balances').upsert({ account_key: accountKey, starting_balance: amount, updated_at: new Date().toISOString() }, { onConflict: 'user_id,account_key' })
  if (res.error) throw new Error(res.error.message)
}

/**
 * Which balance the drawdown % should be measured against.
 * - One account: its starting balance and its deposits/withdrawals.
 * - All accounts: the combined balance, but only when every traded account has a starting balance or
 *   deposits recorded. If any account's size is unknown, return no balance so the dashboard falls back
 *   to % of the P&L peak (a partial total would understate the account size and overstate the %).
 */
export function balanceBasis(
  selected: string | null, // null = all accounts
  tradedAccounts: string[],
  balances: Record<string, number>,
  transfers: Transfer[],
): { startBalance: number | null; transfers: Transfer[] } {
  if (selected != null) {
    return { startBalance: balances[selected] > 0 ? balances[selected] : null, transfers: transfers.filter((t) => t.account_key === selected) }
  }
  const moved = new Set(transfers.map((t) => t.account_key))
  const allKnown = tradedAccounts.length > 0 && tradedAccounts.every((a) => balances[a] > 0 || moved.has(a))
  if (!allKnown) return { startBalance: null, transfers: [] }
  const total = Object.values(balances).reduce((s, v) => s + (v > 0 ? v : 0), 0)
  return { startBalance: total > 0 ? total : null, transfers }
}
