import { useMemo } from 'react'
import type { Trade } from '../lib/types'
import { equityCurve, summarize } from '../lib/stats'
import { fmtMoney, fmtPct, pnlClass } from '../lib/format'
import { EquityChart } from '../components/EquityChart'

function Stat({ label, value, cls = '' }: { label: string; value: string; cls?: string }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className={`value ${cls}`}>{value}</div>
    </div>
  )
}

export function Dashboard({ trades }: { trades: Trade[] }) {
  const s = useMemo(() => summarize(trades), [trades])
  const curve = useMemo(() => equityCurve(trades), [trades])

  if (!trades.length) {
    return (
      <>
        <h1>Dashboard</h1>
        <div className="panel"><p>No trades yet. Head to Import or Trades to add some.</p></div>
      </>
    )
  }

  const pf = s.profitFactor === Infinity ? '∞' : s.profitFactor.toFixed(2)
  return (
    <>
      <h1>Dashboard</h1>
      <div className="stats">
        <Stat label="Net P&L" value={fmtMoney(s.net)} cls={pnlClass(s.net)} />
        <Stat label="Win rate" value={fmtPct(s.winRate)} />
        <Stat label="Profit factor" value={pf} cls={s.profitFactor >= 1 ? 'win' : 'loss'} />
        <Stat label="Trades" value={`${s.count}`} />
        <Stat label="Avg win" value={fmtMoney(s.avgWin)} cls="win" />
        <Stat label="Avg loss" value={fmtMoney(s.avgLoss)} cls="loss" />
        <Stat label="Max drawdown" value={fmtMoney(-s.maxDrawdown)} cls={s.maxDrawdown ? 'loss' : ''} />
        <Stat label="Fees paid" value={fmtMoney(s.fees, false)} />
      </div>
      <div className="panel">
        <h3>Equity curve</h3>
        <EquityChart points={curve} />
      </div>
      <div className="stats">
        <Stat label="Best trade" value={fmtMoney(s.best)} cls={pnlClass(s.best)} />
        <Stat label="Worst trade" value={fmtMoney(s.worst)} cls={pnlClass(s.worst)} />
        <Stat label="Wins / losses" value={`${s.wins} / ${s.losses}`} />
      </div>
    </>
  )
}
