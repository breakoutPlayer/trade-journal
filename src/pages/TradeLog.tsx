import { useMemo, useState } from 'react'
import type { Trade } from '../lib/types'
import { deleteTrade, netPnl } from '../lib/trades'
import { fmtDateTime, fmtMoney, fmtNum, pnlClass } from '../lib/format'
import { TradeForm } from '../components/TradeForm'
import { ChartViewer } from '../components/Charts'
import { removeCharts } from '../lib/charts'

interface Props {
  trades: Trade[]
  reload: () => void
}

export function TradeLog({ trades, reload }: Props) {
  const [editing, setEditing] = useState<Trade | 'new' | null>(null)
  const [viewing, setViewing] = useState<Trade | null>(null)
  const [search, setSearch] = useState('')
  const [tag, setTag] = useState('')

  const allTags = useMemo(() => [...new Set(trades.flatMap((t) => t.tags ?? []))].sort(), [trades])

  const q = search.trim().toLowerCase()
  const shown = trades.filter((t) => {
    const hay = `${t.symbol} ${t.notes ?? ''} ${t.exchange ?? ''}`.toLowerCase()
    return (!q || hay.includes(q)) && (!tag || (t.tags ?? []).includes(tag))
  })

  async function remove(t: Trade) {
    if (!confirm(`Delete this ${t.symbol} trade? This cannot be undone.`)) return
    try {
      await deleteTrade(t.id)
      removeCharts(t.charts ?? []).catch(() => {})
      reload()
    } catch (err) {
      alert((err as Error).message)
    }
  }

  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <h1 style={{ margin: 0 }}>Trade log</h1>
        <span className="spacer" />
        <button className="primary" onClick={() => setEditing('new')}>+ New trade</button>
      </div>

      <div className="panel">
        <div className="row" style={{ marginBottom: 12 }}>
          <input
            style={{ maxWidth: 280 }}
            placeholder="Search symbol, notes, exchange…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select style={{ maxWidth: 200 }} value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">All tags</option>
            {allTags.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <span className="muted">
            {shown.length} of {trades.length} trades
          </span>
        </div>

        {shown.length === 0 ? (
          <p>No trades here yet. Add one manually or import a CSV.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Closed</th>
                  <th>Symbol</th>
                  <th>Side</th>
                  <th className="num">Size</th>
                  <th className="num">Entry</th>
                  <th className="num">Exit</th>
                  <th className="num">Net P&amp;L</th>
                  <th>Tags</th>
                  <th>Notes</th>
                  <th>Charts</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((t) => {
                  const net = netPnl(t)
                  return (
                    <tr key={t.id}>
                      <td>{fmtDateTime(t.closed_at ?? t.opened_at)}</td>
                      <td>
                        <strong>{t.symbol}</strong>
                        {t.exchange && <div className="muted">{t.exchange}</div>}
                      </td>
                      <td>
                        <span className={`side ${t.side === 'short' ? 'loss' : 'win'}`}>{t.side ?? '—'}</span>
                      </td>
                      <td className="num">{fmtNum(t.size)}</td>
                      <td className="num">{fmtNum(t.entry_price)}</td>
                      <td className="num">{fmtNum(t.exit_price)}</td>
                      <td className={`num ${pnlClass(net)}`}>{fmtMoney(net)}</td>
                      <td>
                        {(t.tags ?? []).map((g) => (
                          <span key={g} className="tag">{g}</span>
                        ))}
                      </td>
                      <td className="notes">{t.notes}</td>
                      <td>
                        {(t.charts ?? []).length > 0 ? (
                          <button className="link" onClick={() => setViewing(t)}>
                            View ({t.charts!.length})
                          </button>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        <div className="row" style={{ flexWrap: 'nowrap' }}>
                          <button onClick={() => setEditing(t)}>Edit</button>
                          <button className="danger" onClick={() => remove(t)}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {viewing && (
        <ChartViewer
          title={`${viewing.symbol} · ${fmtDateTime(viewing.closed_at ?? viewing.opened_at)}`}
          paths={viewing.charts ?? []}
          onClose={() => setViewing(null)}
        />
      )}

      {editing && (
        <TradeForm
          trade={editing === 'new' ? undefined : editing}
          onCancel={() => setEditing(null)}
          onDone={() => {
            setEditing(null)
            reload()
          }}
        />
      )}
    </>
  )
}
