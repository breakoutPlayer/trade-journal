import { useMemo, useState } from 'react'
import type { Trade } from '../lib/types'
import type { Summary } from '../lib/stats'
import { dayKey, netPnl, tradeTime } from '../lib/trades'
import { pnlClass } from '../lib/format'
import { dailyCumulative, performanceScore, weekdaySummary } from '../lib/dashboard'

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)
const tiny = (n: number) => {
  const a = Math.abs(n)
  const v = a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1000 ? `${(a / 1000).toFixed(1)}K` : String(Math.round(a))
  return (n < 0 ? '-' : '') + v
}

// Dollar formatting for the dashboard cards, e.g. $7,183.75 / -$638 / $1.05K.
const full = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const short = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 })
const sign = (n: number) => (n < 0 ? '-' : '')
const usd = (n: number) => `${sign(n)}$${full.format(Math.abs(n))}`
const usdShort = (n: number) => {
  const a = Math.abs(n)
  return `${sign(n)}$${a < 1000 ? String(Math.round(a * 100) / 100) : short.format(a)}`
}

// ---------- Top stat cards ----------

/** Ring split into the green (gross profit) and red (gross loss) share. */
function Donut({ win, loss }: { win: number; loss: number }) {
  const r = 22
  const c = 2 * Math.PI * r
  const total = win + loss
  const w = total ? (win / total) * c : 0
  return (
    <svg className="mini-viz" viewBox="0 0 56 56" aria-hidden>
      <circle cx="28" cy="28" r={r} className="ring-track" />
      {total > 0 && <circle cx="28" cy="28" r={r} className="ring-loss" />}
      {w > 0 && <circle cx="28" cy="28" r={r} className="ring-win" style={{ strokeDasharray: `${w} ${c}` }} transform="rotate(-90 28 28)" />}
    </svg>
  )
}

/** Half-circle split into wins / break-even / losses. */
function HalfGauge({ wins, be, losses }: { wins: number; be: number; losses: number }) {
  const total = wins + be + losses || 1
  const c = Math.PI * 30
  const seg = (from: number, len: number, cls: string) =>
    len > 0 && <path d="M8 40 A30 30 0 0 1 68 40" className={cls} style={{ strokeDasharray: `${(len / total) * c} ${c}`, strokeDashoffset: -(from / total) * c }} />
  return (
    <div className="half-gauge">
      <svg viewBox="0 0 76 44" aria-hidden>
        <path d="M8 40 A30 30 0 0 1 68 40" className="arc-track" />
        {seg(0, wins, 'arc-win')}
        {seg(wins, be, 'arc-be')}
        {seg(wins + be, losses, 'arc-loss')}
      </svg>
      <div className="hg-counts">
        <span className="cnt win">{wins}</span><span className="cnt be">{be}</span><span className="cnt loss">{losses}</span>
      </div>
    </div>
  )
}

export function StatCards({ s, trades }: { s: Summary; trades: Trade[] }) {
  const be = s.count - s.wins - s.losses
  const pf = s.profitFactor === Infinity ? '∞' : s.profitFactor.toFixed(2)
  const ratio = s.avgLoss ? s.avgWin / -s.avgLoss : null
  const winShare = s.avgWin + -s.avgLoss ? (s.avgWin / (s.avgWin + -s.avgLoss)) * 100 : 50
  return (
    <div className="stat-row">
      <div className="stat-card">
        <div>
          <div className="stat-label">Net P&amp;L <span className="stat-count">{trades.length}</span></div>
          <div className={`stat-value ${pnlClass(s.net)}`}>{usd(s.net)}</div>
        </div>
      </div>
      <div className="stat-card">
        <div><div className="stat-label">Profit factor</div><div className="stat-value">{pf}</div></div>
        <Donut win={s.grossWin} loss={s.grossLoss} />
      </div>
      <div className="stat-card">
        <div><div className="stat-label">Trade win %</div><div className="stat-value">{(s.winRate * 100).toFixed(2)}%</div></div>
        <HalfGauge wins={s.wins} be={be} losses={s.losses} />
      </div>
      <div className="stat-card">
        <div><div className="stat-label">Avg win/loss trade</div><div className="stat-value">{ratio == null ? '—' : ratio.toFixed(2)}</div></div>
        <div className="wl-bar">
          <div className="wl-track"><span className="w" style={{ width: `${winShare}%` }} /><span className="l" /></div>
          <div className="wl-labels"><span className="win">{usd(s.avgWin)}</span><span className="loss">{usd(s.avgLoss)}</span></div>
        </div>
      </div>
    </div>
  )
}

// ---------- Calendar ----------

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function CalendarCard({ trades }: { trades: Trade[] }) {
  const thisMonth = () => new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  const [month, setMonth] = useState(() => {
    // Start on the month of the latest trade, so the calendar isn't empty early in a new month.
    const latest = trades.reduce<Date | null>((m, t) => { const d = tradeTime(t); return !m || d > m ? d : m }, null)
    return latest ? new Date(latest.getFullYear(), latest.getMonth(), 1) : thisMonth()
  })
  const byDay = useMemo(() => {
    const m = new Map<string, { net: number; count: number; wins: number }>()
    for (const t of trades) {
      const k = dayKey(tradeTime(t))
      const cur = m.get(k) ?? { net: 0, count: 0, wins: 0 }
      const n = netPnl(t)
      cur.net += n; cur.count++; if (n > 0) cur.wins++
      m.set(k, cur)
    }
    return m
  }, [trades])

  const y = month.getFullYear(), mo = month.getMonth()
  const lead = new Date(y, mo, 1).getDay()
  const total = new Date(y, mo + 1, 0).getDate()
  const slots: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: total }, (_, i) => i + 1)]
  while (slots.length % 7) slots.push(null)
  const weeks = Array.from({ length: slots.length / 7 }, (_, i) => slots.slice(i * 7, i * 7 + 7))
  const info = (d: number) => byDay.get(dayKey(new Date(y, mo, d)))
  const days = Array.from({ length: total }, (_, i) => info(i + 1)).filter(Boolean) as { net: number; count: number }[]
  const monthNet = days.reduce((a, d) => a + d.net, 0)
  const monthTrades = days.reduce((a, d) => a + d.count, 0)
  const today = dayKey(new Date())

  return (
    <section className="dcard cal-card">
      <div className="cal-bar">
        <button className="icon-plain" onClick={() => setMonth(new Date(y, mo - 1, 1))} aria-label="Previous month">◀</button>
        <strong>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</strong>
        <button className="icon-plain" onClick={() => setMonth(new Date(y, mo + 1, 1))} aria-label="Next month">▶</button>
        <button className="outline-btn" onClick={() => setMonth(thisMonth())}>This month</button>
        <span className="spacer" />
        <span className="muted-strong">Monthly stats:</span>
        <span className={`stat-pill ${monthNet >= 0 ? 'pos' : 'neg'}`}>{usdShort(monthNet)}</span>
        <span className="stat-pill days">{monthTrades} {plural(monthTrades, 'trade', 'trades')}</span>
        <span className="stat-pill days">{days.length} {plural(days.length, 'day', 'days')}</span>
      </div>
      <div className="cal2">
        <div className="cal2-grid">
          {DOW.map((d) => <div key={d} className="cal2-dow">{d}</div>)}
          {weeks.flat().map((d, i) => {
            if (!d) return <div key={i} className="cal2-day blank" />
            const inf = info(d)
            const cls = inf ? (inf.net > 0 ? 'pos' : inf.net < 0 ? 'neg' : 'flat') : ''
            return (
              <div key={i} className={`cal2-day ${cls} ${dayKey(new Date(y, mo, d)) === today ? 'today' : ''}`}>
                <span className="dn">{d}</span>
                {inf && (
                  <div className="dv">
                    <b><span className="amt">{usdShort(inf.net)}</span><span className="amt-xs">{tiny(inf.net)}</span></b>
                    <span>{inf.count} {plural(inf.count, 'trade', 'trades')}</span>
                    <span className="wr">{((inf.wins / inf.count) * 100).toFixed(1)}%</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <div className="cal2-weeks">
          <div className="cal2-dow">&nbsp;</div>
          {weeks.map((w, wi) => {
            const ds = w.map((d) => (d ? info(d) : undefined)).filter(Boolean) as { net: number }[]
            const net = ds.reduce((a, d) => a + d.net, 0)
            return (
              <div key={wi} className="cal2-week">
                <span className="wk">Week {wi + 1}</span>
                <b className={ds.length ? pnlClass(net) : ''}>{usdShort(net)}</b>
                <span className="stat-pill days">{ds.length} {plural(ds.length, 'day', 'days')}</span>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

// ---------- Score radar ----------

export function ScoreCard({ s, trades }: { s: Summary; trades: Trade[] }) {
  const res = useMemo(() => performanceScore(s, trades), [s, trades])
  const W = 320, H = 220, cx = W / 2, cy = H / 2 + 4, R = 74
  const pt = (i: number, r: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 6
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
  }
  const poly = (r: (i: number) => number) => Array.from({ length: 6 }, (_, i) => pt(i, r(i)).join(',')).join(' ')
  return (
    <section className="dcard">
      <h3 className="dcard-title" title="Blends win %, profit factor, avg win/loss, recovery factor, max drawdown and consistency (share of green days).">Tidemark score</h3>
      {!res ? <p className="widget-empty">Needs at least 3 trades.</p> : (
        <>
          <svg className="radar" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Score ${res.score.toFixed(0)} of 100`}>
            {[0.25, 0.5, 0.75, 1].map((f) => <polygon key={f} points={poly(() => R * f)} className="radar-grid" />)}
            {Array.from({ length: 6 }, (_, i) => { const [x, y] = pt(i, R); return <line key={i} x1={cx} y1={cy} x2={x} y2={y} className="radar-grid" /> })}
            <polygon points={poly((i) => (R * res.axes[i].value) / 100)} className="radar-area" />
            {res.axes.map((a, i) => { const [x, y] = pt(i, (R * a.value) / 100); return <circle key={a.label} cx={x} cy={y} r="2.5" className="radar-dot"><title>{`${a.label}: ${a.value.toFixed(0)}`}</title></circle> })}
            {res.axes.map((a, i) => {
              const [x, y] = pt(i, R + 16)
              return <text key={a.label} x={x} y={y} className="radar-label" textAnchor={Math.abs(x - cx) < 4 ? 'middle' : x > cx ? 'start' : 'end'} dominantBaseline="middle">{a.label}</text>
            })}
          </svg>
          <div className="score-foot">
            <div><span className="muted">Your score</span><b>{res.score.toFixed(2)}</b></div>
            <div className="score-scale">
              <div className="score-bar"><span style={{ left: `${res.score}%` }} /></div>
              <div className="score-ticks"><span>0</span><span>20</span><span>40</span><span>60</span><span>80</span><span>100</span></div>
            </div>
          </div>
        </>
      )}
    </section>
  )
}

// ---------- Daily net cumulative P&L ----------

export function CumulativeCard({ trades }: { trades: Trade[] }) {
  const data = useMemo(() => dailyCumulative(trades), [trades])
  const [hover, setHover] = useState<number | null>(null)
  const W = 400, H = 220, L = 48, B = 22, T = 8, Rr = 8
  const vals = data.map((d) => d.total)
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals)
  const span = hi - lo || 1
  const x = (i: number) => L + (data.length > 1 ? (i / (data.length - 1)) * (W - L - Rr) : (W - L - Rr) / 2)
  const yv = (v: number) => T + ((hi - v) / span) * (H - T - B)
  const line = data.map((d, i) => `${i ? 'L' : 'M'}${x(i)},${yv(d.total)}`).join(' ')
  const area = data.length ? `${line} L${x(data.length - 1)},${yv(0)} L${x(0)},${yv(0)} Z` : ''
  const up = (vals[vals.length - 1] ?? 0) >= 0
  const ticks = Array.from({ length: 5 }, (_, i) => lo + (span * i) / 4)
  const labelIdx = data.length <= 4 ? data.map((_, i) => i) : [0, Math.round((data.length - 1) / 3), Math.round((2 * (data.length - 1)) / 3), data.length - 1]
  const fmtDay = (k: string) => new Date(k + 'T00:00:00').toLocaleDateString(undefined, { month: '2-digit', day: '2-digit', year: '2-digit' })
  const h = hover == null ? null : data[hover]

  return (
    <section className="dcard">
      <h3 className="dcard-title">Daily net cumulative P&amp;L</h3>
      {!data.length ? <p className="widget-empty">No trades yet.</p> : (
        <div className="cum-wrap">
          <svg viewBox={`0 0 ${W} ${H}`} className="cum" onMouseLeave={() => setHover(null)}
            onMouseMove={(e) => {
              const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
              const px = ((e.clientX - r.left) / r.width) * W
              let best = 0
              data.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i })
              setHover(best)
            }}>
            <defs>
              <linearGradient id="cumfill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={up ? 'var(--win)' : 'var(--loss)'} stopOpacity="0.55" />
                <stop offset="100%" stopColor={up ? 'var(--win)' : 'var(--loss)'} stopOpacity="0.04" />
              </linearGradient>
            </defs>
            {ticks.map((v, i) => (
              <g key={i}>
                <line x1={L} x2={W - Rr} y1={yv(v)} y2={yv(v)} className="cum-grid" />
                <text x={L - 6} y={yv(v)} className="cum-axis" textAnchor="end" dominantBaseline="middle">{usdShort(v)}</text>
              </g>
            ))}
            <path d={area} fill="url(#cumfill)" />
            <path d={line} className={`cum-line ${up ? 'up' : 'down'}`} />
            {labelIdx.map((i) => <text key={i} x={x(i)} y={H - 6} className="cum-axis" textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}>{fmtDay(data[i].day)}</text>)}
            {h && hover != null && (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="cum-hover" />
                <circle cx={x(hover)} cy={yv(h.total)} r="3.5" className={`cum-dot ${up ? 'up' : 'down'}`} />
              </g>
            )}
          </svg>
          {h && (
            <div className="cum-tip">
              <span className="muted">{fmtDay(h.day)}</span>
              <b className={pnlClass(h.total)}>{usd(h.total)}</b>
              <span className={pnlClass(h.net)}>day {usd(h.net)}</span>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

// ---------- Performance summary ----------

export function PerformanceSummary({ trades }: { trades: Trade[] }) {
  const w = useMemo(() => weekdaySummary(trades), [trades])
  if (!w) return null
  const money = (n: number) => <span className={`money-pill ${n >= 0 ? 'pos' : 'neg'}`}>{usd(n)}</span>
  const tr = (n: number) => `${n} ${plural(n, 'trade', 'trades')}`
  return (
    <section className="perf">
      <h2 className="perf-title">Performance summary</h2>
      <div className="perf-grid">
        <div className="perf-card">
          <div className="perf-label"><span className="pi up">↗</span>Best performing day</div>
          <div className="perf-day">{w.best.day}</div>
          <div className="perf-meta">{tr(w.best.count)} {money(w.best.net)}</div>
        </div>
        <div className="perf-card">
          <div className="perf-label"><span className="pi down">↘</span>Least performing day</div>
          <div className="perf-day">{w.least.day}</div>
          <div className="perf-meta">{tr(w.least.count)} {money(w.least.net)}</div>
        </div>
        <div className="perf-card">
          <div className="perf-label"><span className="pi act">ϟ</span>Most active day</div>
          <div className="perf-day">{w.active.day}</div>
          <div className="perf-meta">{tr(w.active.count)}</div>
        </div>
        <div className="perf-card">
          <div className="perf-label"><span className="pi rate">★</span>Best win rate</div>
          <div className="perf-day">{w.winRate.day}</div>
          <div className="perf-meta">{(w.winRate.winRate * 100).toFixed(0)}% / {tr(w.winRate.count)}</div>
        </div>
      </div>
    </section>
  )
}
