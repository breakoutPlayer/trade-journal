import Papa from 'papaparse'
import type { Trade, TradeInput } from './types'

export type Exchange = 'hyperliquid' | 'bitunix'

export interface ImportResult {
  exchange: Exchange
  trades: TradeInput[]
  warnings: string[]
}

type Row = Record<string, string>

// ---------- small helpers ----------

/** "Avg. Entry Price (USDT)" -> "avgentrypriceusdt" so header matching ignores case/spaces/symbols. */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Find the first header that matches one of the aliases (exact first, then "starts with"). */
function findCol(headers: string[], aliases: string[]): string | undefined {
  const n = headers.map(norm)
  for (const a of aliases.map(norm)) {
    const i = n.indexOf(a)
    if (i >= 0) return headers[i]
  }
  for (const a of aliases.map(norm)) {
    const i = n.findIndex((h) => h.startsWith(a))
    if (i >= 0) return headers[i]
  }
  return undefined
}

/** "1,234.5 USDT" -> 1234.5 ; "--" or "" -> null */
export function parseNum(v: string | undefined): number | null {
  if (v === undefined) return null
  const cleaned = v.replace(/,/g, '').replace(/[^0-9eE.+-]/g, '')
  if (cleaned === '' || cleaned === '-' || cleaned === '+') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

/** Accepts epoch seconds/ms, "MM/DD/YYYY - HH:mm:ss", "YYYY-MM-DD HH:mm:ss" (local) and ISO strings. */
export function parseDate(v: string | undefined): Date | null {
  if (!v) return null
  const s = v.trim()
  if (/^\d{10}(\.\d+)?$/.test(s)) return new Date(Number(s) * 1000)
  if (/^\d{13}$/.test(s)) return new Date(Number(s))
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s*-?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (m) return new Date(+m[3], +m[1] - 1, +m[2], +m[4], +m[5], +(m[6] ?? 0))
  m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0))
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

/** "BTCUSDT", "BTC-USDT", "btc/usdc", "ETH-PERP" -> "BTC"/"ETH" so pairs group together across exchanges. */
export function normSymbol(s: string) {
  const u = s.toUpperCase().replace(/[\s/_-]/g, '')
  return u.replace(/(PERP|SWAP)$/, '').replace(/(USDT|USDC|USD)$/, '') || u
}

function sideFrom(s: string | undefined): 'long' | 'short' | null {
  const v = (s ?? '').toLowerCase()
  if (v.includes('short') || v.includes('sell')) return 'short'
  if (v.includes('long') || v.includes('buy')) return 'long'
  return null
}

const iso = (d: Date | null) => (d ? d.toISOString() : null)
/** Trim floating-point noise like 1.9999999999999998. */
const r8 = (n: number) => Math.round(n * 1e8) / 1e8

function readCsv(text: string): { headers: string[]; rows: Row[] } {
  const res = Papa.parse<Row>(text.replace(/^﻿/, ''), { header: true, skipEmptyLines: 'greedy', transformHeader: (h) => h.trim() })
  return { headers: res.meta.fields ?? [], rows: res.data }
}

export function detectExchange(headers: string[]): Exchange | null {
  const n = headers.map(norm)
  if (n.includes('dir') && n.includes('closedpnl')) return 'hyperliquid'
  if (n.some((h) => h.includes('pnl') || h.includes('profit'))) return 'bitunix'
  return null
}

// ---------- Hyperliquid: one row per fill, grouped into round-trip trades ----------

interface Position {
  side: 'long' | 'short'
  openQty: number
  openNotional: number
  closeQty: number
  closeNotional: number
  pnl: number
  fees: number
  openedAt: Date | null
  closedAt: Date | null
}

function parseHyperliquid(headers: string[], rows: Row[]): ImportResult {
  const col = {
    time: findCol(headers, ['time', 'timestamp', 'date']),
    coin: findCol(headers, ['coin', 'symbol', 'asset']),
    dir: findCol(headers, ['dir', 'direction']),
    px: findCol(headers, ['px', 'price']),
    sz: findCol(headers, ['sz', 'size', 'qty']),
    fee: findCol(headers, ['fee', 'fees']),
    pnl: findCol(headers, ['closedPnl', 'closed pnl', 'pnl']),
  }
  const missing = (['time', 'coin', 'dir', 'px', 'sz'] as const).filter((k) => !col[k])
  if (missing.length) throw new Error(`Hyperliquid CSV is missing column(s): ${missing.join(', ')}. Found: ${headers.join(', ')}`)

  const warnings: string[] = []
  let skippedSpot = 0

  const fills = rows
    .map((r) => ({
      time: parseDate(r[col.time!]),
      coin: normSymbol(r[col.coin!] ?? ''),
      dir: (r[col.dir!] ?? '').trim().toLowerCase(),
      px: parseNum(r[col.px!]) ?? 0,
      sz: Math.abs(parseNum(r[col.sz!]) ?? 0),
      fee: col.fee ? parseNum(r[col.fee]) ?? 0 : 0,
      pnl: col.pnl ? parseNum(r[col.pnl]) ?? 0 : 0,
    }))
    .filter((f) => f.coin && f.sz > 0)
    .sort((a, b) => (a.time?.getTime() ?? 0) - (b.time?.getTime() ?? 0)) // exports are newest-first

  const open = new Map<string, Position>()
  const trades: TradeInput[] = []

  const emit = (coin: string, p: Position) => {
    trades.push({
      symbol: coin,
      side: p.side,
      entry_price: p.openQty > 0 ? r8(p.openNotional / p.openQty) : null,
      exit_price: p.closeQty > 0 ? r8(p.closeNotional / p.closeQty) : null,
      size: r8(p.closeQty),
      pnl: r8(p.pnl),
      fees: r8(p.fees),
      exchange: 'Hyperliquid',
      opened_at: iso(p.openedAt),
      closed_at: iso(p.closedAt),
      notes: null,
      tags: [],
    })
    open.delete(coin)
  }
  const fresh = (side: 'long' | 'short', at: Date | null): Position => ({
    side, openQty: 0, openNotional: 0, closeQty: 0, closeNotional: 0, pnl: 0, fees: 0, openedAt: at, closedAt: null,
  })
  const addOpen = (coin: string, side: 'long' | 'short', px: number, qty: number, fee: number, at: Date | null) => {
    let p = open.get(coin)
    if (!p || p.side !== side) {
      if (p) emit(coin, p) // shouldn't happen, but never lose data
      p = fresh(side, at)
      open.set(coin, p)
    }
    p.openQty += qty
    p.openNotional += px * qty
    p.fees += fee
  }
  const addClose = (coin: string, side: 'long' | 'short', px: number, qty: number, fee: number, pnl: number, at: Date | null) => {
    let p = open.get(coin)
    if (!p || p.side !== side) {
      // Close without a matching open (the export started mid-position): keep it, entry will be unknown.
      p = fresh(side, null)
      open.set(coin, p)
    }
    p.closeQty += qty
    p.closeNotional += px * qty
    p.pnl += pnl
    p.fees += fee
    p.closedAt = at
    if (p.closeQty >= p.openQty * (1 - 1e-9)) emit(coin, p) // position is flat
  }

  for (const f of fills) {
    const d = f.dir
    if (d.includes('>')) {
      // A flip, e.g. "Long > Short": closes the old position and opens the new one in one fill.
      const [from, to] = d.split('>').map((x) => sideFrom(x))
      if (!from || !to) continue
      const p = open.get(f.coin)
      const closeQty = p && p.side === from ? Math.min(f.sz, Math.max(p.openQty - p.closeQty, 0)) : 0
      const openQty = f.sz - closeQty
      if (closeQty > 0) addClose(f.coin, from, f.px, closeQty, (f.fee * closeQty) / f.sz, f.pnl, f.time)
      if (openQty > 0) addOpen(f.coin, to, f.px, openQty, (f.fee * openQty) / f.sz, f.time)
    } else if (d.startsWith('open')) {
      addOpen(f.coin, sideFrom(d) ?? 'long', f.px, f.sz, f.fee, f.time)
    } else if (d.startsWith('close') || d.includes('liquidat')) {
      addClose(f.coin, sideFrom(d) ?? 'long', f.px, f.sz, f.fee, f.pnl, f.time)
    } else {
      skippedSpot++ // "Buy" / "Sell" = spot fills, not perp trades
    }
  }

  if (skippedSpot) warnings.push(`Skipped ${skippedSpot} spot fill(s) (Buy/Sell); only perp trades are imported.`)
  if (open.size) warnings.push(`${open.size} position(s) still open (${[...open.keys()].join(', ')}): not imported until closed.`)
  return { exchange: 'hyperliquid', trades, warnings }
}

// ---------- Bitunix: position history, one row per closed position ----------

function parseBitunix(headers: string[], rows: Row[]): ImportResult {
  const col = {
    symbol: findCol(headers, ['futures', 'symbol', 'trading pair', 'pair', 'contract', 'coin', 'market']),
    side: findCol(headers, ['side', 'direction', 'position side', 'position direction', 'type']),
    entry: findCol(headers, ['avg entry price', 'average entry price', 'entry price', 'avg open price', 'open price', 'open avg price', 'entry']),
    exit: findCol(headers, ['avg close price', 'average close price', 'close price', 'avg exit price', 'exit price', 'close avg price']),
    size: findCol(headers, ['closed amount', 'close amount', 'closed qty', 'closed quantity', 'qty', 'quantity', 'amount', 'size', 'position size', 'max open interest', 'volume']),
    pnl: findCol(headers, ['realized pnl', 'realised pnl', 'closed pnl', 'pnl', 'realized profit', 'profit']),
    fee: findCol(headers, ['trading fee', 'transaction fee', 'fee', 'fees', 'commission']),
    funding: findCol(headers, ['funding fee', 'funding']),
    opened: findCol(headers, ['open time', 'opening time', 'opened time', 'create time', 'created time', 'opened']),
    closed: findCol(headers, ['close time', 'closing time', 'closed time', 'update time', 'time', 'date']),
  }
  const missing = (['symbol', 'pnl'] as const).filter((k) => !col[k])
  if (missing.length) throw new Error(`Bitunix CSV is missing column(s): ${missing.join(', ')}. Found: ${headers.join(', ')}`)

  const warnings: string[] = []
  // "Fee" can accidentally match the funding column if there's no separate trading fee column.
  if (col.fee && col.fee === col.funding) col.fee = undefined

  const trades: TradeInput[] = rows
    .filter((r) => (r[col.symbol!] ?? '').trim())
    .map((r) => {
      const funding = col.funding ? parseNum(r[col.funding]) ?? 0 : 0
      return {
        symbol: normSymbol(r[col.symbol!]),
        side: sideFrom(col.side ? r[col.side] : undefined),
        entry_price: col.entry ? parseNum(r[col.entry]) : null,
        exit_price: col.exit ? parseNum(r[col.exit]) : null,
        size: col.size ? Math.abs(parseNum(r[col.size]) ?? 0) || null : null,
        pnl: r8((parseNum(r[col.pnl!]) ?? 0) + funding), // funding paid/received counts toward the result
        fees: col.fee ? Math.abs(parseNum(r[col.fee]) ?? 0) : 0,
        exchange: 'Bitunix',
        opened_at: iso(col.opened ? parseDate(r[col.opened]) : null),
        closed_at: iso(col.closed ? parseDate(r[col.closed]) : null),
        notes: null,
        tags: [],
      }
    })

  const notFound = (['side', 'entry', 'exit', 'size', 'fee', 'closed'] as const).filter((k) => !col[k])
  if (notFound.length) warnings.push(`Columns not found (left blank): ${notFound.join(', ')}.`)
  if (col.funding) warnings.push(`Funding ("${col.funding}") was added into P&L.`)
  return { exchange: 'bitunix', trades, warnings }
}

// ---------- entry point ----------

export function parseCsv(text: string, choice: Exchange | 'auto'): ImportResult {
  const { headers, rows } = readCsv(text)
  if (!headers.length) throw new Error('The file looks empty.')
  const ex = choice === 'auto' ? detectExchange(headers) : choice
  if (!ex) throw new Error(`Could not tell which exchange this CSV is from. Pick one manually. Headers: ${headers.join(', ')}`)
  return ex === 'hyperliquid' ? parseHyperliquid(headers, rows) : parseBitunix(headers, rows)
}

/** Same exchange + symbol + close time + P&L = the same trade. */
const key = (t: Pick<Trade, 'exchange' | 'symbol' | 'closed_at' | 'pnl'>) =>
  [t.exchange ?? '', t.symbol, t.closed_at ? new Date(t.closed_at).getTime() : '', Number(t.pnl ?? 0).toFixed(6)].join('|')

export function splitDuplicates(incoming: TradeInput[], existing: Trade[]) {
  const seen = new Set(existing.map(key))
  const fresh: TradeInput[] = []
  let dupes = 0
  for (const t of incoming) {
    const k = key(t)
    if (seen.has(k)) dupes++
    else {
      seen.add(k)
      fresh.push(t)
    }
  }
  return { fresh, dupes }
}
