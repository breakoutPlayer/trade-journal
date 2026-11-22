import type { Trade } from './types'
import { dayKey, netPnl, tradeTime } from './trades'
import { equityCurve, summarize } from './stats'
import { fmtMoney } from './format'
import { weekStart } from './dashboard'

export type Fmt = 'money' | 'pct' | 'num' | 'dur'
/** A metric computed from any set of trades, so it can be charted over time as well as shown as a tile. */
export interface Metric { id: string; label: string; fmt: Fmt; calc: (trades: Trade[]) => number | null; signed?: boolean }

export const REPORT_TABS = ['PnL', 'Averages', 'Performance', 'Drawdown', 'Trades', 'Hold Time', 'Commissions', 'Advanced'] as const
export type ReportTab = (typeof REPORT_TABS)[number]

export function fmtDuration(mins: number | null) {
  if (mins == null) return '–'
  if (mins < 1) return `${Math.round(mins * 60)}s`
  if (mins < 60) return `${Math.round(mins)}m`
  if (mins < 1440) return `${(mins / 60).toFixed(1).replace(/\.0$/, '')}h`
  return `${(mins / 1440).toFixed(1).replace(/\.0$/, '')}d`
}

export function fmtMetric(v: number | null, f: Fmt) {
  if (v == null || Number.isNaN(v)) return '–'
  if (v === Infinity) return '∞'
  if (f === 'money') return fmtMoney(v, false)
  if (f === 'pct') return `${v.toFixed(2)}%`
  if (f === 'dur') return fmtDuration(v)
  return String(+v.toFixed(2))
}

function holdMins(t: Trade): number | null {
  if (!t.opened_at || !t.closed_at) return null
  const m = (new Date(t.closed_at).getTime() - new Date(t.opened_at).getTime()) / 60000
  return m >= 0 ? m : null
}

const isOpen = (t: Trade) => !t.closed_at && t.exit_price == null
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0)
const gross = (ts: Trade[]) => sum(ts.map((t) => Number(t.pnl) || 0))
/** Net P&L as a % of the position's cost, when entry price and size are known. */
const pctOf = (t: Trade) => (t.entry_price && t.size ? (netPnl(t) / (Math.abs(t.entry_price) * Math.abs(t.size))) * 100 : null)
const pcts = (ts: Trade[]) => ts.map(pctOf).filter((v): v is number => v != null)
const wins = (ts: Trade[]) => ts.filter((t) => netPnl(t) > 0)
const losses = (ts: Trade[]) => ts.filter((t) => netPnl(t) < 0)
const breakeven = (ts: Trade[]) => ts.filter((t) => !isOpen(t) && netPnl(t) === 0)
const fees = (ts: Trade[]) => sum(ts.map((t) => Number(t.fees) || 0))
const payoff = (ts: Trade[]) => { const s = summarize(ts); return s.avgLoss ? s.avgWin / -s.avgLoss : null }
const kelly = (ts: Trade[]) => { const r = payoff(ts); return r ? (summarize(ts).winRate - (1 - summarize(ts).winRate) / r) * 100 : null }
const expectancy = (ts: Trade[]) => { const s = summarize(ts); return ts.length ? s.winRate * s.avgWin + (s.losses / s.count) * s.avgLoss : null }
const profitFactor = (ts: Trade[]) => (ts.length ? summarize(ts).profitFactor : null)
const rate = (ts: Trade[], part: Trade[]) => (ts.length ? (part.length / ts.length) * 100 : null)

function streak(ts: Trade[], win: boolean) {
  const sorted = [...ts].sort((a, b) => tradeTime(a).getTime() - tradeTime(b).getTime())
  let cur = 0, max = 0
  for (const t of sorted) {
    const n = netPnl(t)
    cur = (win ? n > 0 : n < 0) ? cur + 1 : 0
    max = Math.max(max, cur)
  }
  return max
}

/** Drawdown stats along the equity curve. */
function drawdown(ts: Trade[]) {
  let peak = 0, maxDd = 0, cur = 0, sinceHigh = 0
  const dds: number[] = []
  for (const p of equityCurve(ts)) {
    if (p.equity >= peak) { peak = p.equity; sinceHigh = 0 } else sinceHigh++
    cur = peak - p.equity
    maxDd = Math.max(maxDd, cur)
    dds.push(cur)
  }
  return { peak, maxDd, cur, sinceHigh, dds }
}

const M = (id: string, fmt: Fmt, calc: Metric['calc'], signed = false): Metric => ({ id, label: id, fmt, calc, signed })

export const METRICS: Record<ReportTab, Metric[]> = {
  PnL: [
    M('PnL Gross $', 'money', (t) => gross(t), true), M('PnL Net $', 'money', (t) => summarize(t).net, true),
    M('PnL $ on Long', 'money', (t) => summarize(t.filter((x) => x.side === 'long')).net, true), M('Account Balance', 'money', (t) => summarize(t).net, true),
    M('PnL $ on Winners', 'money', (t) => summarize(t).grossWin, true), M('PnL $ on Losers', 'money', (t) => -summarize(t).grossLoss, true),
    M('PnL $ on Short', 'money', (t) => summarize(t.filter((x) => x.side === 'short')).net, true), M('Biggest Profit $', 'money', (t) => Math.max(0, summarize(t).best), true),
    M('Biggest Loss $', 'money', (t) => Math.min(0, summarize(t).worst), true), M('Profit/Loss Ratio', 'num', payoff),
    M('Kelly Criterion', 'pct', kelly), M('Trade $ Expectancy', 'money', expectancy, true),
  ],
  Averages: [
    M('Avg PnL $', 'money', (t) => (t.length ? summarize(t).net / t.length : null), true), M('Avg PnL %', 'pct', (t) => mean(pcts(t))),
    M('Avg PnL $ on Winners', 'money', (t) => summarize(t).avgWin, true), M('Avg PnL % on Winners', 'pct', (t) => mean(pcts(wins(t)))),
    M('Avg PnL $ on Losers', 'money', (t) => summarize(t).avgLoss, true), M('Avg PnL % on Losers', 'pct', (t) => mean(pcts(losses(t)))),
    M('PnL $ / Size', 'money', (t) => { const sz = sum(t.map((x) => Math.abs(Number(x.size) || 0))); return sz ? summarize(t).net / sz : null }, true),
    M('Trade $ Expectancy', 'money', expectancy, true),
  ],
  Performance: [
    M('Win %', 'pct', (t) => rate(t, wins(t))), M('Loss %', 'pct', (t) => rate(t, losses(t))), M('BE %', 'pct', (t) => rate(t, breakeven(t))), M('Open %', 'pct', (t) => rate(t, t.filter(isOpen))),
    M('Profit Factor', 'num', profitFactor), M('Profit/Loss Ratio', 'num', payoff), M('Biggest Profit $', 'money', (t) => Math.max(0, summarize(t).best), true),
    M('Biggest % Profit', 'pct', (t) => { const p = pcts(t); return p.length ? Math.max(...p) : null }), M('Biggest Loss $', 'money', (t) => Math.min(0, summarize(t).worst), true),
    M('Biggest % Loser', 'pct', (t) => { const p = pcts(t); return p.length ? Math.min(0, ...p) : null }),
    M('Max Consec. Win', 'num', (t) => streak(t, true)), M('Max Consec. Loss', 'num', (t) => streak(t, false)),
    M('Short/Long Ratio', 'num', (t) => { const l = t.filter((x) => x.side === 'long').length; return l ? t.filter((x) => x.side === 'short').length / l : 0 }),
  ],
  Drawdown: [
    M('Current Drawdown', 'money', (t) => drawdown(t).cur), M('Max Drawdown $', 'money', (t) => drawdown(t).maxDd),
    M('Max Drawdown %', 'pct', (t) => { const d = drawdown(t); return d.peak > 0 ? (d.maxDd / d.peak) * 100 : 0 }),
    M('Avg Drawdown', 'money', (t) => mean(drawdown(t).dds) ?? 0), M('Drawdown Duration', 'num', (t) => drawdown(t).sinceHigh),
    M('Recovery Time/Factor', 'num', (t) => { const d = drawdown(t); return d.maxDd ? summarize(t).net / d.maxDd : 0 }),
  ],
  Trades: [
    M('Total Trades', 'num', (t) => t.length), M('Winning Trades', 'num', (t) => wins(t).length), M('Open Trades', 'num', (t) => t.filter(isOpen).length),
    M('Closed Trades', 'num', (t) => t.filter((x) => !isOpen(x)).length), M('Losing Trades', 'num', (t) => losses(t).length), M('BE Trades', 'num', (t) => breakeven(t).length),
    M('Profit Factor', 'num', profitFactor), M('Total Shares', 'num', (t) => sum(t.map((x) => Math.abs(Number(x.size) || 0)))),
  ],
  'Hold Time': [
    M('Avg Win Hold Time', 'dur', (t) => mean(wins(t).map(holdMins).filter((m): m is number => m != null))),
    M('Avg Loss Hold Time', 'dur', (t) => mean(losses(t).map(holdMins).filter((m): m is number => m != null))),
    M('Avg BE Hold Time', 'dur', (t) => mean(breakeven(t).map(holdMins).filter((m): m is number => m != null))),
  ],
  Commissions: [
    M('Total Fees', 'money', fees), M('Avg Fees', 'money', (t) => (t.length ? fees(t) / t.length : null)),
    M('Win Fees', 'money', (t) => fees(wins(t))), M('Loss Fees', 'money', (t) => fees(losses(t))), M('BE Fees', 'money', (t) => fees(breakeven(t))),
    M('Long Fees', 'money', (t) => fees(t.filter((x) => x.side === 'long'))), M('Short Fees', 'money', (t) => fees(t.filter((x) => x.side === 'short'))),
    M('Open Fees', 'money', (t) => fees(t.filter(isOpen))),
  ],
  Advanced: [
    M('Profit/Loss Ratio', 'num', payoff), M('Kelly Criterion', 'pct', kelly), M('Trade $ Expectancy', 'money', expectancy, true), M('Profit Factor', 'num', profitFactor),
  ],
}

export type Grouping = 'trade' | 'date' | 'week' | 'month' | 'year'
export const GROUPINGS: { id: Grouping; label: string }[] = [
  { id: 'trade', label: 'Trade' }, { id: 'date', label: 'Date' }, { id: 'week', label: 'Week' }, { id: 'month', label: 'Month' }, { id: 'year', label: 'Year' },
]

function periodKey(t: Trade, g: Grouping) {
  const d = tradeTime(t)
  if (g === 'date') return dayKey(d)
  if (g === 'week') return dayKey(weekStart(d))
  if (g === 'month') return dayKey(d).slice(0, 7)
  return String(d.getFullYear())
}

export interface SeriesPoint { label: string; value: number | null }

/**
 * Chart data for one metric. "line" evaluates the metric on everything up to each point
 * (a running value); "bar" evaluates it on just that trade/period.
 */
export function metricSeries(trades: Trade[], metric: Metric, g: Grouping, mode: 'line' | 'bar'): SeriesPoint[] {
  const sorted = [...trades].sort((a, b) => tradeTime(a).getTime() - tradeTime(b).getTime())
  const groups: { label: string; end: number; items: Trade[] }[] = []
  if (g === 'trade') {
    sorted.forEach((t, i) => groups.push({ label: tradeTime(t).toLocaleDateString(), end: i + 1, items: [t] }))
  } else {
    const byKey = new Map<string, { label: string; end: number; items: Trade[] }>()
    sorted.forEach((t, i) => {
      const k = periodKey(t, g)
      const cur = byKey.get(k) ?? { label: k, end: 0, items: [] }
      cur.end = i + 1
      cur.items.push(t)
      byKey.set(k, cur)
    })
    groups.push(...byKey.values())
  }
  // Keep very long histories fast: evaluate at most ~150 points.
  const step = Math.max(1, Math.ceil(groups.length / 150))
  return groups
    .filter((_, i) => i % step === 0 || i === groups.length - 1)
    .map((p) => ({ label: p.label, value: metric.calc(mode === 'line' ? sorted.slice(0, p.end) : p.items) }))
}

export interface Breakdown {
  id: string
  label: string
  group: string
  keysOf: (t: Trade) => string[]
  order?: string[] // fixed display order
  sortKey?: boolean // sort alphabetically by key (hours, months, years)
  fmt?: (k: string) => string
}

function bucket(v: number | null | undefined, edges: [string, number][]) {
  return v == null || !Number.isFinite(v) ? [] : [edges.find(([, max]) => v < max)![0]]
}

const ENTRY: [string, number][] = [['Under $10', 10], ['$10 - $50', 50], ['$50 - $100', 100], ['$100 - $500', 500], ['$500 - $1000', 1000], ['$1000 and Over', Infinity]]
const VOL: [string, number][] = [['Under 1', 1], ['1 - 9.99', 10], ['10 - 19.99', 20], ['20 - 99.99', 100], ['100 and Over', Infinity]]
const HOLD: [string, number][] = [['<5m', 5], ['5-30m', 30], ['30m-1h', 60], ['1-4h', 240], ['4h-1d', 1440], ['>1d', Infinity]]
const WD = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export const BREAKDOWNS: Breakdown[] = [
  { id: 'hourly', label: 'Hourly', group: 'Trade', keysOf: (t) => [String(tradeTime(t).getHours()).padStart(2, '0')], sortKey: true, fmt: (k) => `${k}:00` },
  { id: 'weekday', label: 'Weekday', group: 'Trade', keysOf: (t) => [WD[(tradeTime(t).getDay() + 6) % 7]], order: WD },
  { id: 'month', label: 'Month', group: 'Trade', keysOf: (t) => [String(tradeTime(t).getMonth()).padStart(2, '0')], sortKey: true, fmt: (k) => MONTHS[Number(k)] },
  { id: 'year', label: 'Year', group: 'Trade', keysOf: (t) => [String(tradeTime(t).getFullYear())], sortKey: true },
  { id: 'entry', label: 'Entry Price', group: 'Trade', keysOf: (t) => bucket(t.entry_price, ENTRY), order: ENTRY.map(([l]) => l) },
  { id: 'volume', label: 'Volume', group: 'Trade', keysOf: (t) => bucket(t.size, VOL), order: VOL.map(([l]) => l) },
  { id: 'side', label: 'Side', group: 'Trade', keysOf: (t) => [t.side === 'long' ? 'Long' : t.side === 'short' ? 'Short' : 'Unknown'] },
  { id: 'hold', label: 'Hold Time', group: 'Trade', keysOf: (t) => bucket(holdMins(t), HOLD), order: HOLD.map(([l]) => l) },
  { id: 'symbol', label: 'Symbol', group: 'Trade', keysOf: (t) => [t.symbol] },
  { id: 'setups', label: 'Setups / Tags', group: 'Tags', keysOf: (t) => (t.tags?.length ? t.tags : ['(untagged)']) },
]

/** Orders grouped rows for display: fixed order, key order, or best P&L first. */
export function orderRows<R extends { key: string; net: number }>(b: Breakdown, rows: R[]): (R & { label: string })[] {
  const sorted = [...rows].sort((x, y) => {
    if (b.order) return b.order.indexOf(x.key) - b.order.indexOf(y.key)
    if (b.sortKey) return x.key.localeCompare(y.key)
    return y.net - x.net
  })
  return sorted.map((r) => ({ ...r, label: b.fmt ? b.fmt(r.key) : r.key }))
}
