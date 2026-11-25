import { useMemo, useState, type ReactNode } from 'react'
import type { Trade } from '../lib/types'
import { accountOf, balanceBasis, useAccountBalances } from '../lib/accounts'
import { groupStats, summarize } from '../lib/stats'
import { dayKey, tradeTime } from '../lib/trades'
import { fmtMoney, fmtMoneyShort, fmtPct, pnlClass } from '../lib/format'
import {
  currentStreak, drawdownStats, holdTimePnl, hourlyPnl, monthlyPnl,
  volumeBySymbol, weekdayPnl, weekStart, changePctBuckets, yearMonths,
  type Bar,
} from '../lib/dashboard'
import { CalendarCard, CumulativeCard, DrawdownWidgets, PerformanceSummary, ScoreCard, StatCards } from '../components/DashboardWidgets'
import { BarChart } from '../components/BarChart'
import { RuleCompliance } from '../components/RuleCompliance'

type Range = 'all' | '7d' | '30d' | 'month' | 'year'
const RANGES: { id: Range; label: string }[] = [
  { id: 'all', label: 'All time' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: 'month', label: 'This month' },
  { id: 'year', label: 'This year' },
]

function rangeStart(r: Range): Date | null {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (r === '7d') { today.setDate(today.getDate() - 6); return today }
  if (r === '30d') { today.setDate(today.getDate() - 29); return today }
  if (r === 'month') return new Date(now.getFullYear(), now.getMonth(), 1)
  if (r === 'year') return new Date(now.getFullYear(), 0, 1)
  return null
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

function Widget({ title, children, className = '' }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`widget ${className}`}>
      <h3>{title}</h3>
      {children}
    </section>
  )
}

/** Horizontal distribution rows: label, P&L, and a bar sized by magnitude. */
function DistList({ data }: { data: Bar[] }) {
  if (!data.length) return <div className="widget-empty">No data</div>
  const max = Math.max(1, ...data.map((d) => Math.abs(d.value)))
  return (
    <div className="dist">
      {data.map((d) => (
        <div key={d.label} className="dist-row" title={`${d.count} trade(s)`}>
          <div className="dist-top"><span>{d.label}</span><b className={pnlClass(d.value)}>{fmtMoney(d.value, false)}</b></div>
          <div className="dist-track"><span className={d.value >= 0 ? 'pos' : 'neg'} style={{ width: `${Math.max(2, (Math.abs(d.value) / max) * 100)}%` }} /></div>
        </div>
      ))}
    </div>
  )
}

/** Long vs short head-to-head, like TraderSync's Compare widget. */
function Compare({ trades }: { trades: Trade[] }) {
  const longs = summarize(trades.filter((t) => t.side === 'long'))
  const shorts = summarize(trades.filter((t) => t.side === 'short'))
  const n = longs.count + shorts.count || 1
  const lp = (longs.count / n) * 100
  const pf = (x: number) => (x === Infinity ? '∞' : x ? x.toFixed(2) : '—')
  type S = typeof longs
  const rows: [string, (x: S) => string, (x: S) => string][] = [
    ['P&L (net)', (x) => fmtMoney(x.net, false), (x) => pnlClass(x.net)],
    ['Profit factor', (x) => pf(x.profitFactor), () => ''],
    ['Win %', (x) => (x.count ? fmtPct(x.winRate) : '—'), () => ''],
    ['Avg P&L', (x) => fmtMoney(x.count ? x.net / x.count : 0, false), (x) => pnlClass(x.net)],
    ['Avg win', (x) => fmtMoney(x.avgWin, false), () => ''],
  ]
  return (
    <div>
      <div className="cmp-head"><span><b className="loss">{(100 - lp).toFixed(0)}%</b> SHORT</span><span>LONG <b className="win">{lp.toFixed(0)}%</b></span></div>
      <div className="cmp-bar"><span className="neg" style={{ flex: shorts.count }} /><span className="pos" style={{ flex: longs.count }} /></div>
      {rows.map(([label, f, c]) => (
        <div key={label} className="cmp-row">
          <div><div className="label">{label}</div><div className={c(shorts)}>{f(shorts)}</div></div>
          <div className="r"><div className="label">{label}</div><div className={c(longs)}>{f(longs)}</div></div>
        </div>
      ))}
    </div>
  )
}

/** Twelve month tiles for one year plus a total. */
function YearCalendar({ trades }: { trades: Trade[] }) {
  const [year, setYear] = useState(new Date().getFullYear())
  const months = useMemo(() => yearMonths(trades, year), [trades, year])
  const total = months.reduce((a, m) => ({ net: a.net + m.net, count: a.count + m.count, wins: a.wins + m.wins }), { net: 0, count: 0, wins: 0 })
  const maxAbs = Math.max(1, ...months.map((m) => Math.abs(m.net)))
  const tile = (m: { net: number; count: number; wins: number }, key: string, name: string, strong = false) => (
    <div key={key} className="ycell" style={m.count ? { background: `rgba(${m.net >= 0 ? '79, 185, 133' : '225, 91, 79'}, ${strong ? 0.16 : 0.08 + 0.22 * (Math.abs(m.net) / maxAbs)})` } : undefined}>
      <span className="yname">{name}</span>
      {m.count ? <><b className={pnlClass(m.net)}>{fmtMoneyShort(m.net)}</b><span className="n">{m.count} · {Math.round((m.wins / m.count) * 100)}%</span></> : <span className="muted">--</span>}
    </div>
  )
  return (
    <div className="ycal">
      <div className="ycell yyear">
        <button aria-label="Previous year" onClick={() => setYear(year - 1)}>‹</button>
        <b>{year}</b>
        <button aria-label="Next year" onClick={() => setYear(year + 1)}>›</button>
      </div>
      {months.map((m, i) => tile(m, String(i), new Date(2000, i, 1).toLocaleDateString(undefined, { month: 'short' }).toUpperCase()))}
      {tile(total, 'total', 'TOTAL', true)}
    </div>
  )
}

/** Semicircle gauge, 0-100. */
function Gauge({ value, label }: { value: number | null; label: string }) {
  const c = Math.PI * 52
  const v = value == null ? 0 : Math.max(0, Math.min(100, value))
  return (
    <div className="gauge">
      <svg viewBox="0 0 130 80" aria-hidden>
        <path d="M13 70 A52 52 0 0 1 117 70" className="g-track" />
        {v > 0 && <path d="M13 70 A52 52 0 0 1 117 70" className="g-fill" style={{ strokeDasharray: `${(v / 100) * c} ${c}` }} />}
      </svg>
      <div className="g-text"><span>{label}</span><b>{value == null ? 'N/A' : Math.round(v)}</b></div>
    </div>
  )
}

const ALL = '__all__'
const ACCOUNT_KEY = 'tidemark.dashboard.account'

export function Dashboard({ trades: everyTrade }: { trades: Trade[] }) {
  const [range, setRange] = useState<Range>('all')
  const [riskRange, setRiskRange] = useState<'today' | 'week'>('today')
  const [account, setAccountState] = useState(() => localStorage.getItem(ACCOUNT_KEY) ?? ALL)
  const setAccount = (v: string) => { setAccountState(v); localStorage.setItem(ACCOUNT_KEY, v) }

  // Accounts present in the data, with trade counts. A saved choice that no longer exists falls back to "All".
  const accounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of everyTrade) m.set(accountOf(t), (m.get(accountOf(t)) ?? 0) + 1)
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [everyTrade])
  const active = account !== ALL && accounts.some(([a]) => a === account) ? account : ALL

  // Balance used for the drawdown % (see balanceBasis for the rules with several accounts).
  const { balances, transfers } = useAccountBalances()
  const basis = useMemo(
    () => balanceBasis(active === ALL ? null : active, accounts.map(([a]) => a), balances, transfers),
    [active, accounts, balances, transfers],
  )

  // Every widget below (including risk status) works on the selected account only.
  const allTrades = useMemo(
    () => (active === ALL ? everyTrade : everyTrade.filter((t) => accountOf(t) === active)),
    [everyTrade, active],
  )

  const trades = useMemo(() => {
    const from = rangeStart(range)
    return from ? allTrades.filter((t) => tradeTime(t) >= from) : allTrades
  }, [allTrades, range])

  const s = useMemo(() => summarize(trades), [trades])

  // Risk status always looks at "now", regardless of the date filter.
  const risk = useMemo(() => {
    const now = new Date()
    const from = riskRange === 'today' ? new Date(now.getFullYear(), now.getMonth(), now.getDate()) : weekStart(now)
    const todayKey = dayKey(now)
    return {
      sum: summarize(allTrades.filter((t) => tradeTime(t) >= from)),
      tradesToday: allTrades.filter((t) => dayKey(tradeTime(t)) === todayKey).length,
      streak: currentStreak(allTrades),
      // % of the account balance at the equity peak (same basis as the drawdown widgets).
      // Null when an account's size is unknown: then only the $ drop is shown.
      dd: drawdownStats(allTrades, basis.startBalance, basis.transfers).current,
    }
  }, [allTrades, riskRange, basis])

  const strategies = useMemo(
    () => groupStats(trades, (t) => t.tags ?? []).sort((a, b) => b.count - a.count).slice(0, 4),
    [trades],
  )

  if (!allTrades.length) {
    return (
      <>
        <h1>Dashboard</h1>
        <div className="panel"><p>No trades yet. Head to Import or Trades to add some.</p></div>
      </>
    )
  }

  const lossRate = s.count ? s.losses / s.count : 0
  const expectancy = s.winRate * s.avgWin + lossRate * s.avgLoss // avgLoss is negative
  const safety = s.count >= 5
    ? 100 * (0.4 * Math.min(1, s.winRate / 0.52) + 0.3 * Math.min(1, (s.profitFactor === Infinity ? 2 : s.profitFactor) / 1.5) + 0.3 * Math.min(1, s.avgLoss ? s.avgWin / -s.avgLoss : 1))
    : null
  const streakWord = risk.streak.kind === 'win' ? plural(risk.streak.length, 'win', 'wins') : risk.streak.kind === 'loss' ? plural(risk.streak.length, 'loss', 'losses') : ''

  return (
    <>
      <div className="row dash-head">
        <h1 className="m-0">Dashboard</h1>
        <span className="spacer" />
        {accounts.length > 0 && (
          <select className="range-select" value={active} onChange={(e) => setAccount(e.target.value)} aria-label="Account">
            <option value={ALL}>{accounts.length > 1 ? `All accounts (${accounts.length})` : 'All accounts'}</option>
            {accounts.map(([a]) => <option key={a} value={a}>{a}</option>)}
          </select>
        )}
        <select className="range-select" value={range} onChange={(e) => setRange(e.target.value as Range)} aria-label="Date range">
          {RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      </div>

      {!trades.length ? (
        <div className="panel"><p>No trades in this date range.</p></div>
      ) : (
        <>
        <StatCards s={s} trades={trades} />
        <div className="dash-main">
          <CalendarCard trades={trades} />
          <div className="dash-side">
            <ScoreCard s={s} trades={trades} />
            <CumulativeCard trades={trades} />
          </div>
        </div>
        <PerformanceSummary trades={trades} />
        <h2 className="perf-title">More insights</h2>
        <div className="dash">
          <Widget title="Rule compliance" className="span-2"><RuleCompliance trades={trades} /></Widget>

          <Widget title="Summary" className="span-1">
            <div className="summary-grid">
              <div><div className="label">Trades</div><div className="big">{s.count}</div></div>
              <div><div className="label">Expectancy</div><div className={`big ${pnlClass(expectancy)}`}>{fmtMoney(expectancy)}</div></div>
              <div><div className="label">Best trade</div><div className={`big ${pnlClass(s.best)}`}>{fmtMoney(s.best)}</div></div>
              <div><div className="label">Worst trade</div><div className={`big ${pnlClass(s.worst)}`}>{fmtMoney(s.worst)}</div></div>
              <div><div className="label">Avg win</div><div className="big win">{fmtMoney(s.avgWin)}</div></div>
              <div><div className="label">Avg loss</div><div className={`big ${s.avgLoss ? 'loss' : ''}`}>{fmtMoney(s.avgLoss)}</div></div>
              <div><div className="label">Max DD</div><div className={`big ${s.maxDrawdown ? 'loss' : ''}`}>{fmtMoney(-s.maxDrawdown)}</div></div>
              <div><div className="label">Fees paid</div><div className="big">{fmtMoney(s.fees, false)}</div></div>
            </div>
          </Widget>

          <Widget title="Current risk status" className="span-1">
            <div className="seg">
              <button className={riskRange === 'today' ? 'active' : ''} onClick={() => setRiskRange('today')}>Today</button>
              <button className={riskRange === 'week' ? 'active' : ''} onClick={() => setRiskRange('week')}>This week</button>
            </div>
            <div className="risk-top">
              <div>
                <div className={`big ${pnlClass(risk.sum.net)}`}>{fmtMoney(risk.sum.net, false)}</div>
                <div className="label">{riskRange === 'today' ? "Today's" : "This week's"} P&L</div>
              </div>
              <div>
                <div className="big">{fmtPct(risk.sum.winRate)}</div>
                <div className="label">Win rate</div>
              </div>
            </div>
            <dl className="kv">
              <dt>Current streak</dt>
              <dd className={risk.streak.kind === 'win' ? 'win' : risk.streak.kind === 'loss' ? 'loss' : ''}>{risk.streak.length} {streakWord}</dd>
              <dt>Trades today</dt><dd>{risk.tradesToday}</dd>
              <dt>Current drawdown</dt>
              {risk.dd.pct != null ? (
                <dd>{(Math.abs(risk.dd.pct) * 100).toFixed(2)}% <span className={`badge ${Math.abs(risk.dd.pct) > 0.1 ? 'neg' : 'pos'}`}>{Math.abs(risk.dd.pct) > 0.1 ? 'CAUTION' : 'SAFE'}</span></dd>
              ) : (
                <dd title="Set a starting balance for every account in Settings → Accounts to see this as a % with a SAFE / CAUTION rating.">
                  <span className={risk.dd.amount < 0 ? 'loss' : ''}>{fmtMoney(risk.dd.amount, false)}</span> <span className="muted fs-12">no balance set</span>
                </dd>
              )}
            </dl>
          </Widget>

          <Widget title="Strategy performance (by tag)" className="span-2">
            {strategies.length ? (
              <div className="strategies">
                {strategies.map((g) => (
                  <div key={g.key} className="strategy">
                    <div className="name">{g.key}</div>
                    <div className={`big ${pnlClass(g.net)}`}>{fmtMoney(g.net)}</div>
                    <div className="muted">{g.count} {plural(g.count, 'trade', 'trades')} · {fmtPct(g.winRate)} win</div>
                  </div>
                ))}
              </div>
            ) : <div className="widget-empty">Tag your trades to see strategies here</div>}
          </Widget>
          <Widget title="Volume (trades by symbol)" className="span-2"><BarChart data={volumeBySymbol(trades)} money={false} /></Widget>

          <Widget title="Account safety score" className="span-2">
            <div className="safety">
              <Gauge value={safety} label="Safety score" />
              <div className="tiles">
                <div className="tile"><span className="label">Win rate</span><b>{fmtPct(s.winRate)}</b><i className={s.winRate > 0.52 ? 'ok' : ''}>NEED &gt; 52%</i></div>
                <div className="tile"><span className="label">Risk : reward</span><b>{s.avgLoss ? (s.avgWin / -s.avgLoss).toFixed(2) : '—'}</b><i>AVG WIN / AVG LOSS</i></div>
                <div className="tile"><span className="label">Expectancy</span><b className={pnlClass(expectancy)}>{fmtMoney(expectancy, false)}</b><i>PER TRADE</i></div>
                <div className="tile"><span className="label">Max drawdown</span><b className={s.maxDrawdown ? 'loss' : ''}>{fmtMoney(-s.maxDrawdown, false)}</b><i>PEAK TO TROUGH</i></div>
              </div>
            </div>
            <p className="safety-note">{s.count >= 5 ? 'Score blends win rate, profit factor and risk:reward.' : `Needs at least 5 closed trades for a rating — you have ${s.count}.`}</p>
          </Widget>
          <Widget title="Compare (long vs short)" className="span-2"><Compare trades={trades} /></Widget>

          <Widget title="Yearly calendar" className="span-4"><YearCalendar trades={trades} /></Widget>

          <DrawdownWidgets trades={trades} startBalance={basis.startBalance} transfers={basis.transfers} />
          <Widget title="Change percent" className="span-1"><DistList data={changePctBuckets(trades)} /></Widget>

          <Widget title="Weekday" className="span-1"><BarChart data={weekdayPnl(trades)} /></Widget>
          <Widget title="Hourly" className="span-1"><BarChart data={hourlyPnl(trades)} /></Widget>
          <Widget title="Hold time" className="span-1"><BarChart data={holdTimePnl(trades)} /></Widget>
          <Widget title="Monthly" className="span-2"><BarChart data={monthlyPnl(trades)} /></Widget>
        </div>
        </>
      )}
    </>
  )
}
