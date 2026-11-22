import { useMemo, useState } from 'react'
import type { Trade } from '../lib/types'
import { groupStats, summarize } from '../lib/stats'
import { netPnl, tradeTime } from '../lib/trades'
import { fmtMoney, fmtPct, pnlClass } from '../lib/format'
import { BREAKDOWNS, GROUPINGS, METRICS, REPORT_TABS, fmtMetric, metricSeries, orderRows, type Grouping, type ReportTab } from '../lib/reports'
import { MetricChart } from '../components/MetricChart'

function GroupTable({ title, label, rows }: { title: string; label: string; rows: ReturnType<typeof orderRows<ReturnType<typeof groupStats>[number]>> }) {
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.net)))
  return (
    <div className="panel">
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p>Nothing to show yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{label}</th>
                <th className="num">Trades</th>
                <th className="num">Win rate</th>
                <th className="num">Profit factor</th>
                <th className="num hide-sm">Avg / trade</th>
                <th className="num">Net P&amp;L</th>
                <th className="bar-cell"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td><strong>{r.label}</strong></td>
                  <td className="num">{r.count}</td>
                  <td className="num">{r.count ? fmtPct(r.winRate) : '—'}</td>
                  <td className="num">{!r.count ? '—' : r.profitFactor === Infinity ? '∞' : r.profitFactor.toFixed(2)}</td>
                  <td className={`num hide-sm ${pnlClass(r.net)}`}>{r.count ? fmtMoney(r.net / r.count) : '—'}</td>
                  <td className={`num ${pnlClass(r.net)}`}>{fmtMoney(r.net)}</td>
                  <td className="bar-cell">
                    <div className="bar" style={{ width: `${(Math.abs(r.net) / maxAbs) * 100}%`, background: r.net >= 0 ? 'var(--win)' : 'var(--loss)' }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
/** Overview: tabbed metric tiles, a chart of the selected metric over time, and a trades list. */
function Overview({ trades }: { trades: Trade[] }) {
  const [tab, setTab] = useState<ReportTab>('PnL')
  const [mode, setMode] = useState<'line' | 'bar'>('line')
  const [grouping, setGrouping] = useState<Grouping>('trade')
  const [selected, setSelected] = useState<Record<string, string>>({})

  const metrics = METRICS[tab]
  const sel = metrics.find((m) => m.id === selected[tab]) ?? metrics[0]
  const fmt = (v: number | null) => fmtMetric(v, sel.fmt)
  const colorOf = (v: number | null) => (sel.signed && v != null && v !== Infinity ? pnlClass(v) : '')

  const values = useMemo(() => metrics.map((m) => ({ m, v: m.calc(trades) })), [metrics, trades])
  const current = values.find((x) => x.m.id === sel.id)?.v ?? null
  const series = useMemo(() => metricSeries(trades, sel, grouping, mode), [trades, sel, grouping, mode])
  const recent = useMemo(() => [...trades].sort((a, b) => tradeTime(b).getTime() - tradeTime(a).getTime()).slice(0, 60), [trades])

  return (
    <div className="rep-main">
      <div className="rep-center">
        <nav className="rep-tabs">
          {REPORT_TABS.map((t) => (
            <button key={t} className={t === tab ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>
          ))}
        </nav>

        <section className="widget">
          <div className="rep-head">
            <div>
              <div className="label">{sel.label}</div>
              <div className={`rep-big ${colorOf(current)}`}>{fmt(current)}</div>
            </div>
            <div className="seg">
              <button className={mode === 'line' ? 'active' : ''} onClick={() => setMode('line')}>Line</button>
              <button className={mode === 'bar' ? 'active' : ''} onClick={() => setMode('bar')}>Bar</button>
            </div>
          </div>
          <div className="rep-by">
            <label className="label" htmlFor="rep-group">By</label>
            <select id="rep-group" value={grouping} onChange={(e) => setGrouping(e.target.value as Grouping)}>
              {GROUPINGS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
            </select>
          </div>
          <MetricChart points={series} mode={mode} fmt={fmt} />
        </section>

        <section className="widget">
          <div className="label">Market stats</div>
          <div className="rep-big" style={{ marginBottom: 12 }}>{tab}</div>
          <div className="rep-tiles">
            {values.map(({ m, v }) => (
              <button key={m.id} className={`rep-tile ${m.id === sel.id ? 'sel' : ''}`} onClick={() => setSelected({ ...selected, [tab]: m.id })}>
                <span className="label">{m.label}</span>
                <b className={m.signed && v != null && v !== Infinity ? pnlClass(v) : ''}>{fmtMetric(v, m.fmt)}</b>
              </button>
            ))}
          </div>
        </section>
      </div>

      <aside className="widget rep-trades">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Status</th><th>Close date</th><th>Symbol</th><th className="num">PnL net $</th><th>Side</th></tr></thead>
            <tbody>
              {recent.map((t) => {
                const n = netPnl(t)
                return (
                  <tr key={t.id}>
                    <td className={n > 0 ? 'win' : n < 0 ? 'loss' : 'muted'}><b>{n > 0 ? 'WIN' : n < 0 ? 'LOSS' : 'BE'}</b></td>
                    <td>{tradeTime(t).toLocaleDateString(undefined, { dateStyle: 'medium' })}</td>
                    <td><span className="tag">{t.symbol}</span></td>
                    <td className={`num ${pnlClass(n)}`}>{fmtMoney(n, false)}</td>
                    <td><span className="tag">{t.side ? t.side[0].toUpperCase() : '–'}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </aside>
    </div>
  )
}

function Breakdown({ id, trades }: { id: string; trades: Trade[] }) {
  const b = BREAKDOWNS.find((x) => x.id === id)!
  const rows = useMemo(() => orderRows(b, groupStats(trades, b.keysOf)), [b, trades])
  return <GroupTable title={`By ${b.label.toLowerCase()}`} label={b.label} rows={rows} />
}

export function Analytics({ trades }: { trades: Trade[] }) {
  const [view, setView] = useState('overview')
  const groups = ['Trade', 'Tags']
  const s = useMemo(() => summarize(trades), [trades])

  return (
    <div className="reports">
      <aside className="rep-nav">
        <h2>Reports</h2>
        <div className="rep-group">Performance</div>
        <button className={view === 'overview' ? 'active' : ''} onClick={() => setView('overview')}>Overview</button>
        {groups.map((g) => (
          <div key={g}>
            <div className="rep-group">{g}</div>
            {BREAKDOWNS.filter((b) => b.group === g).map((b) => (
              <button key={b.id} className={view === b.id ? 'active' : ''} onClick={() => setView(b.id)}>{b.label}</button>
            ))}
          </div>
        ))}
      </aside>
      <div className="rep-body">
        {!s.count ? (
          <div className="panel"><p>No trades yet. Head to Import or Trades to add some.</p></div>
        ) : view === 'overview' ? (
          <Overview trades={trades} />
        ) : (
          <>
            <p style={{ marginTop: 0 }}>Days use your local time and the trade&apos;s close time. A trade with several tags counts toward each tag.</p>
            <Breakdown id={view} trades={trades} />
          </>
        )}
      </div>
    </div>
  )
}
