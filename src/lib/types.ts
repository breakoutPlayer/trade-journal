// Mirrors the `trades` table in Supabase.
export interface Trade {
  id: string
  user_id: string
  symbol: string
  side: 'long' | 'short' | null
  entry_price: number | null
  exit_price: number | null
  size: number | null
  pnl: number | null // gross realized P&L (before fees)
  fees: number | null
  exchange: string | null
  opened_at: string | null
  closed_at: string | null
  notes: string | null
  tags: string[] | null
  charts: string[] | null // Supabase Storage paths of chart screenshots
  // Added later (see README). Optional so the app still loads before the columns exist.
  mistakes?: string[] | null
  targets?: number[] | null // profit target prices
  stops?: number[] | null // stop-loss prices
  // Set by exchange auto-sync (see supabase/migrations). Null for manual/CSV trades.
  external_id?: string | null
  account?: string | null // connection label, e.g. "Main"
  // Settings → Trading Tools (see supabase/migrations/20261123000000_trading_tools.sql)
  custom_tags?: string[] | null // "Category: tag"
  strategy_id?: string | null
  created_at: string
}

// What we send when creating/updating. id, user_id and created_at are filled by the database.
// `charts` is optional so imports can leave it to the column default.
export type TradeInput = Omit<Trade, 'id' | 'user_id' | 'created_at' | 'charts'> & { charts?: string[] | null }
