import type { Bar } from '../lib/dashboard'
import { fmtMoney, fmtMoneyShort } from '../lib/format'

/**
 * Compact vertical bar chart with a zero baseline.
 * `money` bars are green/red by sign; otherwise a neutral count chart.
 */
export function BarChart({ data, money = true }: { data: Bar[]; money?: boolean }) {
  if (!data.length) return <div className="widget-empty">No data</div>
  const max = Math.max(0, ...data.map((d) => d.value))
  const min = Math.min(0, ...data.map((d) => d.value))
  const span = max - min || 1
  const zero = (max / span) * 100 // % from top where zero sits
  return (
    <div className="bars" style={{ ['--n' as string]: data.length }}>
      <div className="bars-plot">
        <div className="bars-zero" style={{ top: `${zero}%` }} />
        {data.map((d) => {
          const h = (Math.abs(d.value) / span) * 100
          const style = d.value >= 0 ? { bottom: `${100 - zero}%`, height: `${h}%` } : { top: `${zero}%`, height: `${h}%` }
          const cls = !money ? 'neutral' : d.value >= 0 ? 'pos' : 'neg'
          return (
            <div
              key={d.label}
              className="bars-col"
              title={`${d.label}: ${money ? fmtMoney(d.value) : d.value}${d.count ? ` · ${d.count} trade(s)` : ''}`}
            >
              <div className={`bars-bar ${cls}`} style={style} />
            </div>
          )
        })}
      </div>
      <div className="bars-labels">
        {data.map((d) => <span key={d.label}>{d.label}</span>)}
      </div>
      {money && <div className="bars-range muted">{fmtMoneyShort(min)} to {fmtMoneyShort(max)}</div>}
    </div>
  )
}
