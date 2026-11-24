import { useMemo, useState } from 'react'
import type { Trade } from '../lib/types'
import { dayKey, netPnl, tradeTime } from '../lib/trades'
import { fmtMoney, fmtMoneyShort, pnlClass } from '../lib/format'

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function Calendar({ trades }: { trades: Trade[] }) {
  // Start on the month of the most recent trade (or today).
  const [month, setMonth] = useState(() => {
    const d = trades.length ? new Date(Math.max(...trades.map((t) => tradeTime(t).getTime()))) : new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })

  const [today] = useState(() => dayKey(new Date()))

  // Net P&L and trade count for every day.
  const byDay = useMemo(() => {
    const m = new Map<string, { net: number; count: number }>()
    for (const t of trades) {
      const k = dayKey(tradeTime(t))
      const cur = m.get(k) ?? { net: 0, count: 0 }
      cur.net += netPnl(t)
      cur.count++
      m.set(k, cur)
    }
    return m
  }, [trades])

  const year = month.getFullYear()
  const mon = month.getMonth()
  const daysInMonth = new Date(year, mon + 1, 0).getDate()
  const lead = (new Date(year, mon, 1).getDay() + 6) % 7 // blanks before day 1 (Monday-first week)

  const days = Array.from({ length: daysInMonth }, (_, i) => {
    const date = new Date(year, mon, i + 1)
    return { date, ...(byDay.get(dayKey(date)) ?? { net: 0, count: 0 }) }
  })
  const active = days.filter((d) => d.count)
  const monthNet = active.reduce((s, d) => s + d.net, 0)
  const greenDays = active.filter((d) => d.net > 0).length
  const maxAbs = Math.max(1, ...active.map((d) => Math.abs(d.net)))

  const shift = (n: number) => setMonth(new Date(year, mon + n, 1))

  return (
    <>
      <h1>P&amp;L calendar</h1>
      <div className="panel">
        <div className="row mb-16">
          <button onClick={() => shift(-1)} aria-label="Previous month">‹</button>
          <h2 className="cal-title">
            {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          </h2>
          <button onClick={() => shift(1)} aria-label="Next month">›</button>
          <span className="spacer" />
          <span className="muted cal-summary">
            {active.length} trading day(s) · {greenDays} green · month{' '}
            <strong className={pnlClass(monthNet)}>{fmtMoney(monthNet)}</strong>
          </span>
        </div>

        <div className="cal">
          {DOW.map((d) => <div key={d} className="dow">{d}</div>)}
          {Array.from({ length: lead }, (_, i) => <div key={`b${i}`} className="day empty" />)}
          {days.map((d) => {
            // Shade the cell more strongly the bigger the day was.
            const alpha = d.count ? 0.12 + 0.45 * (Math.abs(d.net) / maxAbs) : 0
            const rgb = d.net >= 0 ? '79, 185, 133' : '225, 91, 79'
            const isToday = dayKey(d.date) === today
            return (
              <div
                key={d.date.getDate()}
                className="day"
                style={{
                  background: d.count ? `rgba(${rgb}, ${alpha})` : undefined,
                  borderColor: isToday ? 'var(--accent)' : undefined,
                }}
                title={d.count ? `${d.count} trade(s), ${fmtMoney(d.net)}` : undefined}
              >
                <span className="d">{d.date.getDate()}</span>
                {d.count > 0 && (
                  <>
                    <span className={`p ${pnlClass(d.net)}`}>
                      <span className="full">{fmtMoney(d.net)}</span>
                      <span className="short">{fmtMoneyShort(d.net)}</span>
                    </span>
                    <span className="n">{d.count} trade{d.count > 1 ? 's' : ''}</span>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
