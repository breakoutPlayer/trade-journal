// Bitunix futures. Docs: https://www.bitunix.com/api-docs/futures/
// Signing: digest = sha256(nonce + timestamp + apiKey + sortedQuery + body); sign = sha256(digest + secret)
import { sha256Hex } from '../crypto.ts'
import { getJson, iso, normSymbol, num, r8 } from '../http.ts'
import type { Creds, ExchangeAdapter, SyncedTrade } from './types.ts'

const HOST = 'https://fapi.bitunix.com'
const DAY = 86_400_000

async function signedGet(creds: Creds, path: string, params: Record<string, string | number>) {
  const entries = Object.entries(params).map(([k, v]) => [k, String(v)] as const).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const sortedForSign = entries.map(([k, v]) => k + v).join('')
  const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('')
  const timestamp = String(Date.now())
  const digest = await sha256Hex(nonce + timestamp + creds.apiKey + sortedForSign)
  const sign = await sha256Hex(digest + creds.apiSecret)
  const qs = new URLSearchParams(entries as [string, string][]).toString()
  const body = await getJson(`${HOST}${path}${qs ? '?' + qs : ''}`, {
    'api-key': creds.apiKey, nonce, timestamp, sign, language: 'en-US', 'Content-Type': 'application/json',
  }, 'Bitunix')
  if (body?.code !== 0) throw new Error(`Bitunix: ${body?.msg ?? 'request failed'} (code ${body?.code})`)
  return body.data
}

export const bitunix: ExchangeAdapter = {
  id: 'bitunix',
  label: 'Bitunix',
  needsPassphrase: false,

  // Bitunix has no endpoint that reports key permissions; we only confirm the key works.
  // The UI requires the user to confirm the key is read-only.
  async checkPermissions(creds) {
    await signedGet(creds, '/api/v1/futures/position/get_history_positions', { limit: 1 })
    return { ok: true }
  },

  async fetchClosedTrades(creds, sinceMs) {
    // startTime filters on position *create* time, so look back further and filter on close time.
    const startTime = sinceMs - 30 * DAY
    const out: SyncedTrade[] = []
    for (let skip = 0; skip < 20_000; skip += 100) {
      const data = await signedGet(creds, '/api/v1/futures/position/get_history_positions', { startTime, limit: 100, skip })
      const list: any[] = data?.positionList ?? []
      for (const p of list) {
        const closedMs = Number(p.mtime)
        if (!closedMs || closedMs < sinceMs) continue
        const realized = num(p.realizedPNL) ?? 0 // excludes fee and funding
        const funding = num(p.funding) ?? 0
        out.push({
          external_id: String(p.positionId),
          symbol: normSymbol(String(p.symbol)),
          side: String(p.side).toUpperCase() === 'SHORT' ? 'short' : 'long',
          entry_price: num(p.entryPrice),
          exit_price: num(p.closePrice),
          size: num(p.maxQty),
          pnl: r8(realized + funding), // funding counts toward the result, like the CSV importer
          fees: r8(Math.abs(num(p.fee) ?? 0)),
          exchange: 'Bitunix',
          opened_at: iso(p.ctime),
          closed_at: iso(closedMs),
        })
      }
      if (list.length < 100) break
    }
    return out
  },
}
