import type { Trade } from './types'
import { netPnl, tradeTime } from './trades'

export interface Summary {
  count: number
  wins: number
  losses: number
  net: number
  fees: number
  grossWin: number // sum of winning trades (net)
  grossLoss: number // sum of losing trades (net, as a positive number)
  winRate: number // 0..1
  profitFactor: number // Infinity when there are no losses
  avgWin: number
  avgLoss: number
  best: number
  worst: number
  maxDrawdown: number
}

export function summarize(trades: Trade[]): Summary {
  let wins = 0, losses = 0, net = 0, fees = 0, grossWin = 0, grossLoss = 0
  let best = -Infinity, worst = Infinity
  for (const t of trades) {
    const n = netPnl(t)
    net += n
    fees += Number(t.fees) || 0
    if (n > 0) { wins++; grossWin += n }
    else if (n < 0) { losses++; grossLoss += -n }
    best = Math.max(best, n)
    worst = Math.min(worst, n)
  }
  const curve = equityCurve(trades)
  let peak = 0, maxDrawdown = 0
  for (const p of curve) {
    peak = Math.max(peak, p.equity)
    maxDrawdown = Math.max(maxDrawdown, peak - p.equity)
  }
  const count = trades.length
  return {
    count, wins, losses, net, fees, grossWin, grossLoss,
    winRate: count ? wins / count : 0,
    profitFactor: grossLoss ? grossWin / grossLoss : grossWin ? Infinity : 0,
    avgWin: wins ? grossWin / wins : 0,
    avgLoss: losses ? -grossLoss / losses : 0,
    best: count ? best : 0,
    worst: count ? worst : 0,
    maxDrawdown,
  }
}

export interface CurvePoint {
  time: Date
  equity: number
  trade: Trade
}

/** Running total of net P&L, oldest trade first. */
export function equityCurve(trades: Trade[]): CurvePoint[] {
  const sorted = [...trades].sort((a, b) => tradeTime(a).getTime() - tradeTime(b).getTime())
  let equity = 0
  return sorted.map((trade) => {
    equity += netPnl(trade)
    return { time: tradeTime(trade), equity, trade }
  })
}

/** Groups trades by a key and summarizes each group. A trade can belong to several groups (tags). */
export function groupStats(trades: Trade[], keysOf: (t: Trade) => string[]) {
  const groups = new Map<string, Trade[]>()
  for (const t of trades) {
    for (const k of keysOf(t)) {
      if (!groups.has(k)) groups.set(k, [])
      groups.get(k)!.push(t)
    }
  }
  return [...groups.entries()].map(([key, list]) => ({ key, ...summarize(list) }))
}
