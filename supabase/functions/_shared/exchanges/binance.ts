// Binance USDT-M futures. Docs: https://developers.binance.com/docs/derivatives/usds-margined-futures/
// Signing: HMAC-SHA256(secret, queryString) appended as &signature=..., key in X-MBX-APIKEY.
//
// Binance has no "closed positions" endpoint, so we rebuild round-trip positions from fills
// (/fapi/v1/userTrades) the same way the Hyperliquid CSV importer does, and attach funding
// from /fapi/v1/income.
import { hmacHex } from '../crypto.ts'
import { getJson, iso, normSymbol, r8, sleep } from '../http.ts'
import type { Creds, ExchangeAdapter, SyncedTrade } from './types.ts'

const FAPI = 'https://fapi.binance.com'
const SAPI = 'https://api.binance.com'
const DAY = 86_400_000
const WEEK = 7 * DAY - 1 // userTrades/income time windows must be under 7 days
const LOOKBACK = 30 * DAY // fetch fills this far before `since` so positions opened earlier are complete

async function signedGet(creds: Creds, host: string, path: string, params: Record<string, string | number> = {}) {
  const qs = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), recvWindow: '10000', timestamp: String(Date.now()) }).toString()
  const signature = await hmacHex(creds.apiSecret, qs)
  return getJson(`${host}${path}?${qs}&signature=${signature}`, { 'X-MBX-APIKEY': creds.apiKey }, 'Binance')
}

/** Calls `fn` for each <7-day window from start to end. */
async function eachWindow(start: number, end: number, fn: (s: number, e: number) => Promise<void>) {
  for (let s = start; s < end; s += WEEK + 1) await fn(s, Math.min(s + WEEK, end))
}

interface Fill { id: number; time: number; side: 'BUY' | 'SELL'; positionSide: string; price: number; qty: number; pnl: number; fee: number }
interface Pos { side: 'long' | 'short'; firstId: number; openQty: number; openNotional: number; closeQty: number; closeNotional: number; pnl: number; fees: number; openedAt: number; closedAt: number; orphan: boolean }

export const binance: ExchangeAdapter = {
  id: 'binance',
  label: 'Binance (USDT-M)',
  needsPassphrase: false,

  async checkPermissions(creds) {
    const r = await signedGet(creds, SAPI, '/sapi/v1/account/apiRestrictions')
    if (!r?.enableReading) return { ok: false, reason: 'This Binance key does not have "Enable Reading".' }
    const risky: [string, string][] = [
      ['enableWithdrawals', 'withdrawals'], ['enableFutures', 'futures trading'], ['enableSpotAndMarginTrading', 'spot & margin trading'],
      ['enableMargin', 'margin'], ['enableInternalTransfer', 'internal transfer'], ['permitsUniversalTransfer', 'universal transfer'],
      ['enableVanillaOptions', 'options trading'], ['enablePortfolioMarginTrading', 'portfolio margin trading'],
    ]
    const on = risky.filter(([k]) => r[k] === true).map(([, name]) => name)
    if (on.length) return { ok: false, reason: `This Binance key allows ${on.join(', ')}. Create a key with only "Enable Reading".` }
    return { ok: true }
  },

  async fetchClosedTrades(creds, sinceMs) {
    const now = Date.now()
    const fillStart = sinceMs - LOOKBACK

    // 1) Which symbols were traded? Realized-PnL and commission income entries list them.
    const symbols = new Set<string>()
    const funding: { symbol: string; time: number; amount: number }[] = []
    await eachWindow(fillStart, now, async (s, e) => {
      for (let from = s; ;) {
        const rows: any[] = await signedGet(creds, FAPI, '/fapi/v1/income', { startTime: from, endTime: e, limit: 1000 })
        for (const r of rows) {
          if (r.symbol && (r.incomeType === 'REALIZED_PNL' || r.incomeType === 'COMMISSION')) symbols.add(r.symbol)
          if (r.symbol && r.incomeType === 'FUNDING_FEE') funding.push({ symbol: r.symbol, time: Number(r.time), amount: Number(r.income) })
        }
        if (rows.length < 1000) break
        from = Number(rows[rows.length - 1].time) + 1
      }
    })

    const out: SyncedTrade[] = []
    for (const symbol of symbols) {
      // 2) All fills for the symbol, oldest first.
      const fills = new Map<number, Fill>()
      await eachWindow(fillStart, now, async (s, e) => {
        for (let from = s; ;) {
          const rows: any[] = await signedGet(creds, FAPI, '/fapi/v1/userTrades', { symbol, startTime: from, endTime: e, limit: 1000 })
          for (const t of rows) fills.set(Number(t.id), {
            id: Number(t.id), time: Number(t.time), side: t.side, positionSide: t.positionSide ?? 'BOTH',
            price: Number(t.price), qty: Number(t.qty), pnl: Number(t.realizedPnl) || 0, fee: Math.abs(Number(t.commission) || 0),
          })
          if (rows.length < 1000) break
          from = Number(rows[rows.length - 1].time) // same-ms fills are de-duplicated by id
        }
      })
      await sleep(100)

      // 3) Rebuild positions. Hedge mode: LONG/SHORT books; one-way: BOTH with a signed net quantity.
      const books = new Map<string, Pos>()
      const emit = (key: string, p: Pos) => {
        books.delete(key)
        if (p.orphan || p.closedAt < sinceMs) return // incomplete history or outside window
        const fund = funding.filter((f) => f.symbol === symbol && f.time >= p.openedAt && f.time <= p.closedAt).reduce((a, f) => a + f.amount, 0)
        out.push({
          external_id: `${symbol}:${p.firstId}`,
          symbol: normSymbol(symbol),
          side: p.side,
          entry_price: p.openQty ? r8(p.openNotional / p.openQty) : null,
          exit_price: p.closeQty ? r8(p.closeNotional / p.closeQty) : null,
          size: r8(p.closeQty),
          pnl: r8(p.pnl + fund),
          fees: r8(p.fees),
          exchange: 'Binance',
          opened_at: iso(p.openedAt),
          closed_at: iso(p.closedAt),
        })
      }
      const open = (key: string, side: 'long' | 'short', f: Fill, qty: number, orphan = false) => {
        let p = books.get(key)
        if (!p) { p = { side, firstId: f.id, openQty: 0, openNotional: 0, closeQty: 0, closeNotional: 0, pnl: 0, fees: 0, openedAt: f.time, closedAt: 0, orphan }; books.set(key, p) }
        p.openQty += qty; p.openNotional += qty * f.price; p.fees += (f.fee * qty) / f.qty
      }
      const close = (key: string, f: Fill, qty: number, pnl: number) => {
        const p = books.get(key)!
        p.closeQty += qty; p.closeNotional += qty * f.price; p.pnl += pnl; p.fees += (f.fee * qty) / f.qty; p.closedAt = f.time
        if (p.closeQty >= p.openQty * (1 - 1e-9)) emit(key, p)
      }

      for (const f of [...fills.values()].sort((a, b) => a.time - b.time || a.id - b.id)) {
        if (f.qty <= 0) continue
        if (f.positionSide === 'LONG' || f.positionSide === 'SHORT') {
          const key = f.positionSide
          const side = key === 'LONG' ? 'long' : 'short'
          const opening = (side === 'long') === (f.side === 'BUY')
          if (opening) open(key, side, f, f.qty)
          else {
            if (!books.has(key)) open(key, side, { ...f, fee: 0 }, f.qty, true) // opened before our window
            close(key, f, f.qty, f.pnl)
          }
          continue
        }
        // One-way mode
        const key = 'BOTH'
        const p = books.get(key)
        const fillSide = f.side === 'BUY' ? 'long' : 'short'
        if (!p) {
          // A closing fill (non-zero realized PnL) with nothing open = position opened before our window.
          if (f.pnl !== 0) { open(key, fillSide === 'long' ? 'short' : 'long', { ...f, fee: 0 }, f.qty, true); close(key, f, f.qty, f.pnl) }
          else open(key, fillSide, f, f.qty)
        } else if (p.side === fillSide) {
          open(key, fillSide, f, f.qty)
        } else {
          const remaining = p.openQty - p.closeQty
          const closeQty = Math.min(f.qty, remaining)
          close(key, f, closeQty, f.pnl)
          const flip = f.qty - closeQty
          if (flip > 1e-12) open(key, fillSide, { ...f, fee: f.fee }, flip)
        }
      }
      // Anything left in `books` is still open: not imported until closed.
    }
    return out
  },
}
