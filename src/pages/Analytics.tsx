import { useMemo, useState } from 'react'
import type { Trade } from '../lib/types'
import { groupStats, summarize } from '../lib/stats'
import { netPnl, tradeStatus, tradeTime } from '../lib/trades'
import { useTradingTools } from '../lib/settings'
import { isFollowed, isReviewed, reviewOf, setupLabel, tradeSetup } from '../lib/rules'
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
          <div className="rep-big mb-12">{tab}</div>
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

const RULE_VIEWS: [string, string][] = [['rules-followed', 'Followed vs not'], ['rules-per-rule', 'Per rule']]

/** Results of reviewed, closed trades: rules followed vs not, and per rule ticked vs missed. */
function RulesReport({ trades, perRule }: { trades: Trade[]; perRule: boolean }) {
  const { labels } = useTradingTools()
  const [setup, setSetup] = useState('')

  const closed = useMemo(() => trades.filter((t) => tradeStatus(t) !== 'OPEN' && tradeSetup(t)), [trades])
  const pool = useMemo(() => (setup ? closed.filter((t) => tradeSetup(t) === setup) : closed), [closed, setup])
  const reviewed = useMemo(() => pool.filter(isReviewed), [pool])
  const setups = useMemo(() => [...new Set([
    ...closed.filter(isReviewed).map((t) => tradeSetup(t)!),
    ...labels.filter((l) => l.kind === 'setup' && (l.bias_rules?.length || l.entry_rules?.length)).map((l) => l.name),
  ])].sort((a, b) => a.localeCompare(b)), [closed, labels])

  const followedRows = useMemo(() => {
    const rows = groupStats(reviewed, (t) => [isFollowed(reviewOf(t)!) ? 'Followed' : 'Not followed'])
    const rank = (k: string) => (k === 'Followed' ? 0 : 1)
    return rows.sort((a, b) => rank(a.key) - rank(b.key)).map((r) => ({ ...r, label: r.key }))
  }, [reviewed])

  const ruleRows = useMemo(() => {
    if (!setup) return []
    const label = setupLabel(labels, setup)
    const rules = new Map<string, { group: string; text: string; hit: Trade[]; miss: Trade[] }>()
    const add = (group: string, id: string, text: string) => {
      if (!rules.has(id)) rules.set(id, { group, text, hit: [], miss: [] })
      return rules.get(id)!
    }
    // Current rules first, in Settings order and wording; then rules that were since removed.
    for (const r of label?.bias_rules ?? []) add('Bias', r.id, r.text)
    for (const r of label?.entry_rules ?? []) add('Entry', r.id, r.text)
    for (const t of reviewed) {
      const rv = reviewOf(t)!
      for (const [group, list] of [['Bias', rv.bias], ['Entry', rv.entry]] as const) {
        for (const r of list) (r.ok ? add(group, r.id, r.text).hit : add(group, r.id, r.text).miss).push(t)
      }
    }
    return [...rules.entries()].map(([id, r]) => ({ id, ...r, hitS: summarize(r.hit), missS: summarize(r.miss) }))
  }, [setup, labels, reviewed])

  const cell = (s: ReturnType<typeof summarize>) => (
    <>
      <td className="num">{s.count}</td>
      <td className="num">{s.count ? fmtPct(s.winRate) : '—'}</td>
      <td className={`num hide-sm ${pnlClass(s.net)}`}>{s.count ? fmtMoney(s.net / s.count) : '—'}</td>
    </>
  )

  return (
    <>
      <div className="row mb-16">
        <select className="range-select" value={setup} onChange={(e) => setSetup(e.target.value)} aria-label="Setup">
          <option value="">{perRule ? 'Pick a setup' : 'All setups'}</option>
          {setups.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="muted fs-13">{reviewed.length} reviewed of {pool.length} closed trades{setup ? ` with “${setup}”` : ' with a setup'}.</span>
      </div>
      {!perRule ? (
        <>
          <p className="mt-0">Followed means every Bias and Entry rule was ticked. Only trades marked reviewed count.</p>
          <GroupTable title="Rules followed vs not" label="Rules" rows={followedRows} />
        </>
      ) : !setup ? (
        <div className="panel"><p className="m-0">Pick a setup to see how each of its rules relates to results.</p></div>
      ) : (
        <div className="panel">
          <h3>Per rule: {setup}</h3>
          <p className="muted fs-12 mt-0">✓ = rule ticked, ✕ = rule missed.</p>
          {ruleRows.length === 0 ? <p>This setup has no rules yet.</p> : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Rule</th>
                    <th className="num">✓ Trades</th><th className="num">✓ Win rate</th><th className="num hide-sm">✓ Avg / trade</th>
                    <th className="num">✕ Trades</th><th className="num">✕ Win rate</th><th className="num hide-sm">✕ Avg / trade</th>
                  </tr>
                </thead>
                <tbody>
                  {ruleRows.map((r) => (
                    <tr key={r.id}>
                      <td className="rule-cell"><span className="muted fs-12">{r.group}</span> {r.text}</td>
                      {cell(r.hitS)}
                      {cell(r.missS)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  )
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
        <div className="rep-group">Trading rules</div>
        {RULE_VIEWS.map(([id, label]) => (
          <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}>{label}</button>
        ))}
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
        ) : view.startsWith('rules-') ? (
          <RulesReport trades={trades} perRule={view === 'rules-per-rule'} />
        ) : view === 'overview' ? (
          <Overview trades={trades} />
        ) : (
          <>
            <p className="mt-0">Days use your local time and the trade&apos;s close time. A trade with several tags counts toward each tag.</p>
            <Breakdown id={view} trades={trades} />
          </>
        )}
      </div>
    </div>
  )
}
