import { binance } from './binance.ts'
import { bitunix } from './bitunix.ts'
import { okx } from './okx.ts'
import type { ExchangeAdapter } from './types.ts'

// To add an exchange: write an adapter implementing ExchangeAdapter, register it here,
// add its id to the `exchange` check in the migration and to src/lib/connections.ts.
export const ADAPTERS: Record<string, ExchangeAdapter> = { bitunix, binance, okx }
