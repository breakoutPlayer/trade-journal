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
  created_at: string
}

// What we send when creating/updating. id, user_id and created_at are filled by the database.
// `charts` is optional so imports can leave it to the column default.
export type TradeInput = Omit<Trade, 'id' | 'user_id' | 'created_at' | 'charts'> & { charts?: string[] | null }
