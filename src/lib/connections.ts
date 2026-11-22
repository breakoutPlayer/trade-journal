import { supabase } from './supabase'

export type ExchangeId = 'bitunix' | 'binance' | 'okx'

export const EXCHANGES: Record<ExchangeId, { label: string; passphrase: boolean; guide: string }> = {
  bitunix: {
    label: 'Bitunix (Futures)',
    passphrase: false,
    guide: 'Bitunix → Account → API Management → Create API. Tick only read permissions; leave Trade and Withdraw OFF. Bitunix cannot report key permissions, so you must confirm this yourself below.',
  },
  binance: {
    label: 'Binance (USDT-M Futures)',
    passphrase: false,
    guide: 'Binance → Account → API Management → Create API (System generated). Keep only "Enable Reading" on. Keys with trading, transfer or withdrawal permission are rejected.',
  },
  okx: {
    label: 'OKX (Perpetual swaps)',
    passphrase: true,
    guide: 'OKX → Profile → API keys → Create. Permission: Read only. You will also set a passphrase; enter it here. Keys with Trade or Withdraw permission are rejected.',
  },
}

export interface Connection {
  id: string
  exchange: ExchangeId
  label: string
  enabled: boolean
  created_at: string
  last_synced_at: string | null
  last_status: string | null
  last_error: string | null
  last_new_count: number | null
}

export interface SyncRun {
  id: number
  connection_id: string
  started_at: string
  finished_at: string | null
  status: string
  new_count: number
  error: string | null
}

export async function fetchConnections(): Promise<Connection[]> {
  const { data, error } = await supabase.from('exchange_connections').select('*').order('created_at')
  if (error) throw error
  return data as Connection[]
}

export async function fetchRuns(): Promise<SyncRun[]> {
  const { data, error } = await supabase.from('sync_runs').select('*').order('started_at', { ascending: false }).limit(30)
  if (error) throw error
  return data as SyncRun[]
}

export async function setEnabled(id: string, enabled: boolean) {
  const { error } = await supabase.from('exchange_connections').update({ enabled }).eq('id', id)
  if (error) throw error
}

/** Calls an Edge Function and surfaces its { error } message. Keys go only to our own function. */
async function invoke(fn: 'connections' | 'sync', body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke(fn, { body })
  if (error) {
    let msg = error.message
    try {
      const ctx = (error as { context?: Response }).context
      const j = ctx ? await ctx.json() : null
      if (j?.error) msg = j.error
    } catch { /* keep generic message */ }
    throw new Error(msg)
  }
  return data
}

export const addConnection = (input: {
  exchange: ExchangeId; label: string; apiKey: string; apiSecret: string; passphrase?: string; confirmReadOnly: boolean
}) => invoke('connections', { action: 'add', ...input })

export const deleteConnection = (id: string) => invoke('connections', { action: 'delete', id })

export const syncNow = (connectionId?: string) => invoke('sync', connectionId ? { connectionId } : {})
