import type { Trade } from './types'
import { dayKey, netPnl, tradeTime } from './trades'

export interface Bar { label: string; value: number; count: number }

function bucket(trades: Trade[], keyOf: (t: Trade) => string): Map<string, { value: number; count: number }> {
  const m = new Map<string, { value: number; count: number }>()
  for (const t of trades) {
    const k = keyOf(t)
    const cur = m.get(k) ?? { value: 0, count: 0 }
    cur.value += netPnl(t)
    cur.count++
    m.set(k, cur)
  }
  return m
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']


export function weekdayPnl(trades: Trade[]): Bar[] {
  const m = bucket(trades, (t) => WEEKDAYS[(tradeTime(t).getDay() + 6) % 7])
  return WEEKDAYS.map((label) => ({ label, ...(m.get(label) ?? { value: 0, count: 0 }) }))
}

/** Only hours that have trades, in order. */
export function hourlyPnl(trades: Trade[]): Bar[] {
  const m = bucket(trades, (t) => String(tradeTime(t).getHours()).padStart(2, '0'))
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => ({ label: `${k}h`, ...v }))
}

export function monthlyPnl(trades: Trade[]): Bar[] {
  const m = bucket(trades, (t) => {
    const d = tradeTime(t)
    return `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`
  })
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-12)
    .map(([k, v]) => ({ label: MONTHS[Number(k.slice(5))], ...v }))
}

/** Net P&L by how long the trade was held. Trades without both timestamps are skipped. */
export function holdTimePnl(trades: Trade[]): Bar[] {
  const buckets: [string, number][] = [
    ['<5m', 5], ['5-30m', 30], ['30m-1h', 60], ['1-4h', 240], ['4h-1d', 1440], ['>1d', Infinity],
  ]
  const out = buckets.map(([label]) => ({ label, value: 0, count: 0 }))
  for (const t of trades) {
    if (!t.opened_at || !t.closed_at) continue
    const mins = (new Date(t.closed_at).getTime() - new Date(t.opened_at).getTime()) / 60000
    if (!(mins >= 0)) continue
    const i = buckets.findIndex(([, max]) => mins < max)
    out[i].value += netPnl(t)
    out[i].count++
  }
  return out.filter((b) => b.count)
}

/** Most-traded symbols by trade count. */
export function volumeBySymbol(trades: Trade[], limit = 8): Bar[] {
  const m = bucket(trades, (t) => t.symbol)
  return [...m.entries()].sort(([, a], [, b]) => b.count - a.count).slice(0, limit)
    .map(([label, v]) => ({ label, value: v.count, count: v.count }))
}

/** Consecutive wins or losses at the end of the trade history. */
export function currentStreak(trades: Trade[]): { kind: 'win' | 'loss' | 'none'; length: number } {
  const sorted = [...trades].sort((a, b) => tradeTime(b).getTime() - tradeTime(a).getTime())
  let kind: 'win' | 'loss' | 'none' = 'none'
  let length = 0
  for (const t of sorted) {
    const n = netPnl(t)
    if (n === 0) continue
    const k = n > 0 ? 'win' : 'loss'
    if (kind === 'none') kind = k
    if (k !== kind) break
    length++
  }
  return { kind, length }
}

/** How far the running total is below its all-time peak, as a % of that peak (0 if no peak yet). */
export function currentDrawdownPct(curve: { equity: number }[]): number {
  let peak = 0
  for (const p of curve) peak = Math.max(peak, p.equity)
  const last = curve.length ? curve[curve.length - 1].equity : 0
  return peak > 0 ? ((peak - last) / peak) * 100 : 0
}

/** Monday 00:00 of the week containing d. */
export function weekStart(d: Date) {
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  s.setDate(s.getDate() - ((s.getDay() + 6) % 7))
  return s
}

/** Groups trades into ordered, labelled buckets (empty buckets are dropped). */
function ranged(trades: Trade[], edges: [string, number][], valueOf: (t: Trade) => number | null): Bar[] {
  const out = edges.map(([label]) => ({ label, value: 0, count: 0 }))
  for (const t of trades) {
    const v = valueOf(t)
    if (v == null || !Number.isFinite(v)) continue
    const i = edges.findIndex(([, max]) => v < max)
    out[i].value += netPnl(t)
    out[i].count++
  }
  return out.filter((b) => b.count)
}

/** % move from entry to exit, signed so a profitable direction is positive. */
export const changePctBuckets = (trades: Trade[]) =>
  ranged(trades, [['Below -5%', -5], ['-5% to -1%', -1], ['-1% to 0%', 0], ['0% to 1%', 1], ['1% to 5%', 5], ['Above 5%', Infinity]], (t) =>
    t.entry_price && t.exit_price ? ((t.exit_price - t.entry_price) / t.entry_price) * 100 * (t.side === 'short' ? -1 : 1) : null)

/** Net P&L per month (0-11) for one year. */
export function yearMonths(trades: Trade[], year: number): { net: number; count: number; wins: number }[] {
  const out = Array.from({ length: 12 }, () => ({ net: 0, count: 0, wins: 0 }))
  for (const t of trades) {
    const d = tradeTime(t)
    if (d.getFullYear() !== year) continue
    const n = netPnl(t)
    const m = out[d.getMonth()]
    m.net += n; m.count++
    if (n > 0) m.wins++
  }
  return out
}

// ---------- Redesigned dashboard (performance summary, score, cumulative P&L) ----------

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export interface WeekdayStat { day: string; net: number; count: number; wins: number; winRate: number }

/** Best / least performing weekday, most active weekday and best win rate (weekdays with trades only). */
export function weekdaySummary(trades: Trade[]) {
  const by = new Map<number, WeekdayStat>()
  for (const t of trades) {
    const d = tradeTime(t).getDay()
    const cur = by.get(d) ?? { day: DAY_NAMES[d], net: 0, count: 0, wins: 0, winRate: 0 }
    const n = netPnl(t)
    cur.net += n
    cur.count++
    if (n > 0) cur.wins++
    by.set(d, cur)
  }
  const list = [...by.values()].map((s) => ({ ...s, winRate: s.count ? s.wins / s.count : 0 }))
  if (!list.length) return null
  const pick = (cmp: (a: WeekdayStat, b: WeekdayStat) => number) => [...list].sort(cmp)[0]
  return {
    best: pick((a, b) => b.net - a.net),
    least: pick((a, b) => a.net - b.net),
    active: pick((a, b) => b.count - a.count || b.net - a.net),
    winRate: pick((a, b) => b.winRate - a.winRate || b.count - a.count),
  }
}

/** Cumulative net P&L at the end of each trading day, oldest first. */
export function dailyCumulative(trades: Trade[]): { day: string; net: number; total: number }[] {
  const by = new Map<string, number>()
  for (const t of trades) {
    const k = dayKey(tradeTime(t))
    by.set(k, (by.get(k) ?? 0) + netPnl(t))
  }
  let total = 0
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, net]) => ({ day, net, total: (total += net) }))
}

export interface ScoreAxis { label: string; value: number } // value 0..100

/**
 * A 0-100 performance score from six axes (each 0-100, then averaged):
 * win %, profit factor, avg win/loss, recovery factor, max drawdown and consistency.
 */
export function performanceScore(s: {
  count: number; winRate: number; profitFactor: number; avgWin: number; avgLoss: number; net: number; grossWin: number; maxDrawdown: number
}, trades: Trade[]): { score: number; axes: ScoreAxis[] } | null {
  if (s.count < 3) return null
  const clamp = (v: number) => Math.max(0, Math.min(100, v))
  const pf = s.profitFactor === Infinity ? 3 : s.profitFactor
  const ratio = s.avgLoss ? s.avgWin / -s.avgLoss : s.avgWin ? 3 : 0
  const recovery = s.maxDrawdown ? s.net / s.maxDrawdown : s.net > 0 ? 3 : 0
  const days = dailyCumulative(trades)
  const greenDays = days.length ? days.filter((d) => d.net > 0).length / days.length : 0
  const axes: ScoreAxis[] = [
    { label: 'Win %', value: clamp((s.winRate / 0.6) * 100) },
    { label: 'Profit factor', value: clamp((pf / 2.5) * 100) },
    { label: 'Avg win/loss', value: clamp((ratio / 2.5) * 100) },
    { label: 'Recovery factor', value: clamp((recovery / 3) * 100) },
    { label: 'Max drawdown', value: clamp(100 * (1 - s.maxDrawdown / Math.max(s.grossWin, 1))) },
    { label: 'Consistency', value: clamp((greenDays / 0.6) * 100) },
  ]
  return { score: axes.reduce((a, x) => a + x.value, 0) / axes.length, axes }
}

// ---------- Drawdown widgets ----------

export interface Drawdown {
  amount: number // <= 0, dollars below the prior equity peak
  pct: number | null // amount / peak equity, when the peak is above 0
  date: Date | null
}

/**
 * Drawdowns on the trade-by-trade equity curve (cumulative net P&L, starting at 0).
 * An episode runs from a new equity high until equity gets back to that high.
 * - max: deepest point of any episode (date = when the low was hit)
 * - average: mean depth of all episodes, including one still in progress
 * - current: how far equity is below its high right now (date = latest trade)
 */
export function drawdownStats(trades: Trade[], startBalance: number | null = null, transfers: { at: string; amount: number }[] = []): { max: Drawdown; average: Drawdown; current: Drawdown; episodes: number } {
  const sorted = [...trades].sort((a, b) => tradeTime(a).getTime() - tradeTime(b).getTime())
  let equity = 0, peak = 0
  // Account balance at a point in time = starting balance + deposits/withdrawals so far + trading P&L.
  const useBalance = (startBalance ?? 0) > 0 || transfers.length > 0
  const moves = [...transfers].map((t) => ({ at: Date.parse(t.at), amount: t.amount })).sort((a, b) => a.at - b.at)
  let mi = 0, deposited = 0
  let peakBase = startBalance ?? 0 // balance excluding P&L, at the time of the current equity peak
  // With a balance: % of the account balance at the peak. Otherwise % of the P&L peak.
  const pctOf = (dd: number, pk: number, base = peakBase) => {
    if (useBalance) { const bal = base + pk; return bal > 0 ? dd / bal : null }
    return pk > 0 ? dd / pk : null
  }
  let max: Drawdown = { amount: 0, pct: null, date: null }
  const episodes: { depth: number; peak: number; base: number }[] = []
  let ep: { depth: number; peak: number; base: number } | null = null
  for (const t of sorted) {
    const when = tradeTime(t).getTime()
    while (mi < moves.length && moves[mi].at <= when) deposited += moves[mi++].amount
    equity += netPnl(t)
    if (equity >= peak) {
      if (ep) { episodes.push(ep); ep = null }
      peak = equity
      peakBase = (startBalance ?? 0) + deposited
      continue
    }
    const dd = equity - peak
    if (!ep) ep = { depth: dd, peak, base: peakBase }
    if (dd < ep.depth) ep.depth = dd
    if (dd < max.amount) max = { amount: dd, pct: pctOf(dd, peak), date: tradeTime(t) }
  }
  if (ep) episodes.push(ep)
  const avg = episodes.length ? episodes.reduce((a, e) => a + e.depth, 0) / episodes.length : 0
  const avgPeak = episodes.length ? episodes.reduce((a, e) => a + e.peak, 0) / episodes.length : 0
  const avgBase = episodes.length ? episodes.reduce((a, e) => a + e.base, 0) / episodes.length : 0
  const last = sorted.length ? tradeTime(sorted[sorted.length - 1]) : null
  return {
    max,
    average: { amount: avg, pct: episodes.length ? pctOf(avg, avgPeak, avgBase) : null, date: null },
    current: { amount: Math.min(0, equity - peak), pct: pctOf(Math.min(0, equity - peak), peak), date: last },
    episodes: episodes.length,
  }
}
