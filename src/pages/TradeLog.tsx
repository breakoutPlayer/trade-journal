import { useMemo, useState } from 'react'
import { useTradingTools } from '../lib/settings'
import { ruleStatus, type RuleStatus } from '../lib/rules'
import type { Trade } from '../lib/types'
import { deleteTrade, netPnl, tradeReturn, tradeStatus } from '../lib/trades'
import { fmtMoney, fmtNum, fmtPct, pnlClass } from '../lib/format'
import { summarize } from '../lib/stats'
import { TradeForm } from '../components/TradeForm'
import { removeCharts } from '../lib/charts'
import { accountOf } from '../lib/accounts'
import { TradeDetail } from './TradeDetail'

interface Props {
  trades: Trade[]
  reload: () => void
  openId: string | null // trade shown in the detail view (kept in App so other pages can open a trade)
  setOpenId: (id: string | null) => void
}

const openTime = (t: Trade) => new Date(t.opened_at ?? t.closed_at ?? t.created_at).getTime()
const fmtDay = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: '2-digit', year: 'numeric' })

export function TradeLog({ trades, reload, openId, setOpenId }: Props) {
  const [editing, setEditing] = useState<Trade | 'new' | null>(null)
  const [search, setSearch] = useState('')
  const [setup, setSetup] = useState('')
  const [mistake, setMistake] = useState('')
  const [side, setSide] = useState('')
  const [account, setAccount] = useState('')
  const [review, setReview] = useState<'' | 'todo' | 'followed' | 'broken'>('')
  const [asc, setAsc] = useState(false)
  const { labels } = useTradingTools()
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const allSetups = useMemo(() => [...new Set(trades.flatMap((t) => t.tags ?? []))].sort(), [trades])
  const allMistakes = useMemo(() => [...new Set(trades.flatMap((t) => t.mistakes ?? []))].sort(), [trades])
  // Same account names as the dashboard and Settings → Accounts (synced, manual and CSV trades).
  const accountKey = accountOf
  const allAccounts = useMemo(() => [...new Set(trades.map(accountOf))].sort(), [trades])

  const q = search.trim().toLowerCase()
  const shown = useMemo(() => {
    const list = trades.filter((t) => {
      const hay = `${t.symbol} ${t.notes ?? ''} ${t.exchange ?? ''} ${t.account ?? ''}`.toLowerCase()
      return (
        (!q || hay.includes(q)) &&
        (!account || accountKey(t) === account) &&
        (!setup || (t.tags ?? []).includes(setup)) &&
        (!mistake || (t.mistakes ?? []).includes(mistake)) &&
        (!side || t.side === side) &&
        (!review || reviewMatch(ruleStatus(t, labels), review))
      )
    })
    return list.sort((a, b) => (asc ? openTime(a) - openTime(b) : openTime(b) - openTime(a)))
  }, [trades, q, setup, mistake, side, account, review, labels, asc])

  const s = useMemo(() => summarize(shown), [shown])
  const filtered = Boolean(q || setup || mistake || side || account || review)
  const clearAll = () => { setSearch(''); setSetup(''); setMistake(''); setSide(''); setAccount(''); setReview('') }

  // Prev/next follow the list as it was when the trade was opened, so a trade that stops
  // matching the filters (e.g. marked reviewed under "Not reviewed") keeps its place.
  const [nav, setNav] = useState<string[] | null>(null)
  if (openId && !nav) setNav(shown.map((t) => t.id))
  if (!openId && nav) setNav(null)

  const opened = openId ? trades.find((t) => t.id === openId) : undefined
  if (opened) {
    const order = nav?.includes(opened.id) ? nav.filter((id) => trades.some((t) => t.id === id)) : shown.map((t) => t.id)
    const i = order.indexOf(opened.id)
    return (
      <>
        <TradeDetail
          trade={opened}
          allSetups={allSetups}
          allMistakes={allMistakes}
          reload={reload}
          onBack={() => setOpenId(null)}
          onEdit={() => setEditing(opened)}
          onDeleted={() => { setOpenId(null); reload() }}
          prev={i > 0 ? () => setOpenId(order[i - 1]) : undefined}
          next={i >= 0 && i < order.length - 1 ? () => setOpenId(order[i + 1]) : undefined}
        />
        {editing && editing !== 'new' && (
          <TradeForm trade={editing} onCancel={() => setEditing(null)} onDone={() => { setEditing(null); reload() }} />
        )}
      </>
    )
  }

  const toggle = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }
  const visibleSelected = shown.filter((t) => selected.has(t.id))
  const allChecked = shown.length > 0 && visibleSelected.length === shown.length

  async function removeSelected() {
    const list = visibleSelected
    if (!list.length || !confirm(`Delete ${list.length} trade${list.length > 1 ? 's' : ''}? This cannot be undone.`)) return
    try {
      for (const t of list) {
        await deleteTrade(t.id)
        removeCharts(t.charts ?? []).catch(() => {})
      }
      setSelected(new Set())
      reload()
    } catch (err) {
      alert((err as Error).message)
    }
  }

  const pf = s.profitFactor === Infinity ? '∞' : s.profitFactor ? s.profitFactor.toFixed(2) : '—'
  const avg = s.count ? s.net / s.count : 0

  return (
    <div className="tl">
      <div className="tl-filters">
        <button className="icon-btn" title="New trade" aria-label="New trade" onClick={() => setEditing('new')}>+</button>
        <input className="tl-search" placeholder="Search symbol, notes, portfolio…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="range-select" value={setup} onChange={(e) => setSetup(e.target.value)} aria-label="Setup">
          <option value="">All setups</option>
          {allSetups.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        {allMistakes.length > 0 && (
          <select className="range-select" value={mistake} onChange={(e) => setMistake(e.target.value)} aria-label="Mistake">
            <option value="">All mistakes</option>
            {allMistakes.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        <select className="range-select" value={side} onChange={(e) => setSide(e.target.value)} aria-label="Side">
          <option value="">Long &amp; short</option>
          <option value="long">Long</option>
          <option value="short">Short</option>
        </select>
        <select className="range-select" value={review} onChange={(e) => setReview(e.target.value as typeof review)} aria-label="Rules review">
          <option value="">All reviews</option>
          <option value="todo">Not reviewed</option>
          <option value="followed">Rules followed</option>
          <option value="broken">Rules not followed</option>
        </select>
        {allAccounts.length > 1 && (
          <select className="range-select" value={account} onChange={(e) => setAccount(e.target.value)} aria-label="Account">
            <option value="">All accounts</option>
            {allAccounts.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        )}
        {filtered && <button className="chip-btn" onClick={clearAll}>Clear all ×</button>}
      </div>

      <div className="tl-kpis">
        <div className="tl-kpi"><span className="label">Net P&amp;L $</span><b className={pnlClass(s.net)}>{fmtMoney(s.net, false)}</b></div>
        <div className="tl-kpi"><span className="label">Profit factor</span><b>{pf}</b></div>
        <div className="tl-kpi"><span className="label">Avg P&amp;L $</span><b className={pnlClass(avg)}>{fmtMoney(avg, false)}</b></div>
        <div className="tl-kpi tl-wl">
          <div className="split"><span className="label">Win</span><span className="label">Loss</span></div>
          <div className="winbar">
            <span className="pos" style={{ flex: s.wins || 0 }} />
            <span className="neg" style={{ flex: s.losses || 0 }} />
          </div>
          <div className="split">
            <b className="win">{s.count ? fmtPct(s.wins / s.count) : '—'} <small>{s.wins}</small></b>
            <b className="loss"><small>{s.losses}</small> {s.count ? fmtPct(s.losses / s.count) : '—'}</b>
          </div>
        </div>
      </div>

      <div className="widget tl-table-wrap">
        {shown.length === 0 ? (
          <p className="widget-empty">{trades.length ? 'No trades match these filters.' : 'No trades yet. Add one with + or import a CSV.'}</p>
        ) : (
          <table className="tl-table">
            <thead>
              <tr>
                <th className="c-check"><input type="checkbox" aria-label="Select all" checked={allChecked} onChange={() => setSelected(allChecked ? new Set() : new Set(shown.map((t) => t.id)))} /></th>
                <th>Status</th>
                <th><button className="th-sort" onClick={() => setAsc(!asc)}>Open date {asc ? '↑' : '↓'}</button></th>
                <th>Symbol</th>
                <th className="num">Entry</th>
                <th className="num">Exit</th>
                <th className="num">Size</th>
                <th className="num">Net P&amp;L $</th>
                <th className="num">Return %</th>
                <th>Side</th>
                <th>Setups</th>
                <th>Mistakes</th>
                <th>Rules</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => {
                const n = netPnl(t)
                const r = tradeReturn(t)
                const st = tradeStatus(t)
                return (
                  <tr key={t.id} onClick={() => setOpenId(t.id)} className={selected.has(t.id) ? 'sel' : ''}>
                    <td className="c-check" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" aria-label={`Select ${t.symbol}`} checked={selected.has(t.id)} onChange={() => toggle(t.id)} />
                    </td>
                    <td className={`c-status st-${st.toLowerCase()}`}>{st}</td>
                    <td className="c-date">{fmtDay(openTime(t))}</td>
                    <td className="c-symbol"><span className="sym">{t.symbol}</span></td>
                    <td className="num" data-label="Entry">{fmtNum(t.entry_price)}</td>
                    <td className="num" data-label="Exit">{fmtNum(t.exit_price)}</td>
                    <td className="num" data-label="Size">{fmtNum(t.size)}</td>
                    <td className={`num c-pnl ${pnlClass(n)}`}>{st === 'OPEN' ? '—' : fmtMoney(n, false)}</td>
                    <td className={`num c-ret ${pnlClass(n)}`}>{r == null || st === 'OPEN' ? '—' : `${(r * 100).toFixed(2)}%`}</td>
                    <td className="c-side"><span className={`side-badge ${t.side === 'short' ? 'short' : 'long'}`}>{t.side ? t.side[0].toUpperCase() : '–'}</span></td>
                    <td className={`c-setups ${(t.tags ?? []).length ? '' : 'c-empty'}`}>{(t.tags ?? []).map((g) => <span key={g} className="chip setup">{g}</span>)}</td>
                    <td className={`c-mistakes ${(t.mistakes ?? []).length ? '' : 'c-empty'}`}>{(t.mistakes ?? []).map((g) => <span key={g} className="chip mistake">{g}</span>)}</td>
                    <RulesCell status={ruleStatus(t, labels)} />
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        <div className="tl-foot">
          <span>Trades: {shown.length}/{trades.length}</span>
          {visibleSelected.length > 0 && (
            <>
              <span className="spacer" />
              <span>{visibleSelected.length} selected</span>
              <button className="danger" onClick={removeSelected}>Delete selected</button>
            </>
          )}
        </div>
      </div>

      {editing && (
        <TradeForm
          trade={editing === 'new' ? undefined : editing}
          onCancel={() => setEditing(null)}
          onDone={() => { setEditing(null); reload() }}
        />
      )}
    </div>
  )
}

/** "Not reviewed" also lists trades without a setup, so fresh imports show up there. */
function reviewMatch(s: RuleStatus, f: 'todo' | 'followed' | 'broken') {
  if (f === 'todo') return s.kind === 'pending' || s.kind === 'no-setup'
  return s.kind === 'reviewed' && s.followed === (f === 'followed')
}

function RulesCell({ status: s }: { status: RuleStatus }) {
  if (s.kind === 'reviewed') {
    return (
      <td className="c-rules">
        <span className={`tbadge ${s.followed ? 'pos-soft' : 'neg-soft'}`} title={s.followed ? 'Rules followed' : 'Rules not followed'}>
          {s.followed ? '✓' : '✕'} {s.done}/{s.total}
        </span>
      </td>
    )
  }
  const text = s.kind === 'pending' ? 'Not reviewed' : s.kind === 'no-rules' ? 'No rules' : 'No setup'
  return <td className={`c-rules muted ${s.kind === 'pending' ? '' : 'c-empty'}`}>{text}</td>
}
