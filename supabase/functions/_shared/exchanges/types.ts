export interface Creds {
  apiKey: string
  apiSecret: string
  passphrase?: string
}

/** A closed trade ready to insert. Mirrors TradeInput in src/lib/types.ts plus sync fields. */
export interface SyncedTrade {
  external_id: string
  symbol: string
  side: 'long' | 'short' | null
  entry_price: number | null
  exit_price: number | null
  size: number | null
  pnl: number | null // gross realized P&L before trading fees, funding folded in (same as CSV import)
  fees: number | null // positive number = cost
  exchange: string // display name, e.g. "Binance"
  opened_at: string | null
  closed_at: string | null
}

export interface PermissionCheck {
  ok: boolean
  reason?: string
}

export interface ExchangeAdapter {
  id: 'bitunix' | 'binance' | 'okx'
  label: string
  needsPassphrase: boolean
  /** Verifies the key works and is read-only. Must not place orders or move funds. */
  checkPermissions(creds: Creds): Promise<PermissionCheck>
  /** Closed positions whose close time is >= sinceMs. */
  fetchClosedTrades(creds: Creds, sinceMs: number): Promise<SyncedTrade[]>
}
