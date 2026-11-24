import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Trade } from '../lib/types'
import { dayKey, friendlySaveError, netPnl, tradeReturn, tradeStatus, tradeTime, updateTrade } from '../lib/trades'
import { summarize } from '../lib/stats'
import { fmtMoney, fmtNum, pnlClass } from '../lib/format'
import { NoteEditor } from '../components/NoteEditor'
import {
  createGeneralNote, deleteJournalNote, fetchJournalNotes, journalError, saveDailyNote, updateJournalNote, type JournalNote,
} from '../lib/journal'

type Tab = 'daily' | 'trade' | 'general'

interface Props {
  trades: Trade[]
  reload: () => void
  openTrade: (id: string) => void
}

const longDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
const shortDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '—')
const preview = (s: string | null) => (s ?? '').replace(/[*_~]/g, '').replace(/\s+/g, ' ').trim()

export function Journal({ trades, reload, openTrade }: Props) {
  const [tab, setTab] = useState<Tab>('daily')
  const [notes, setNotes] = useState<JournalNote[]>([])
  const [error, setError] = useState('')
  const [sel, setSel] = useState<Record<Tab, string | null>>({ daily: null, trade: null, general: null })
  const select = (id: string | null) => setSel((s) => ({ ...s, [tab]: id }))

  // Editors read their starting text once, so none is shown until notes have loaded.
  const [loaded, setLoaded] = useState(false)
  const load = useCallback(() => {
    fetchJournalNotes()
      .then(setNotes, (e) => setError(journalError(e)))
      .finally(() => setLoaded(true))
  }, [])
  useEffect(load, [load])

  // Trading days plus any day that has a daily note, newest first.
  const byDay = useMemo(() => {
    const m = new Map<string, Trade[]>()
    for (const t of trades) {
      const k = dayKey(tradeTime(t))
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(t)
    }
    return m
  }, [trades])
  const daily = useMemo(() => new Map(notes.filter((n) => n.kind === 'daily' && n.day).map((n) => [n.day!, n])), [notes])
  const days = useMemo(() => [...new Set([...byDay.keys(), ...daily.keys()])].sort().reverse(), [byDay, daily])
  const tradeNotes = useMemo(() => trades.filter((t) => t.notes?.trim()).sort((a, b) => tradeTime(b).getTime() - tradeTime(a).getTime()), [trades])
  const general = useMemo(() => notes.filter((n) => n.kind === 'general'), [notes])

  const current = sel[tab] ?? (tab === 'daily' ? days[0] ?? null : null)

  async function newNote() {
    setError('')
    if (tab === 'general') {
      try {
        const n = await createGeneralNote('Untitled note')
        setNotes((list) => [n, ...list])
        select(n.id)
      } catch (e) {
        setError(journalError(e))
      }
    } else {
      setTab('daily')
      setSel((s) => ({ ...s, daily: dayKey(new Date()) }))
    }
  }

  return (
    <div className="jr">
      <div className="jr-top">
        <div className="jr-tabs" role="tablist">
          {(['daily', 'trade', 'general'] as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t === 'daily' ? 'Daily Notes' : t === 'trade' ? 'Trade Notes' : 'General Notes'}
            </button>
          ))}
        </div>
        <span className="spacer" />
        {tab !== 'trade' && <button className="primary jr-new" onClick={newNote}>{tab === 'daily' ? 'Today’s note +' : 'New note +'}</button>}
      </div>
      {error && <div className="panel error td-error">{error}</div>}

      <div className="jr-body">
        <div className="jr-list">
          {tab === 'daily' && (days.length === 0
            ? <p className="jr-empty">No trading days or daily notes yet.</p>
            : days.map((d) => <DayCard key={d} day={d} trades={byDay.get(d) ?? []} hasNote={Boolean(daily.get(d)?.body)} active={d === current} onClick={() => select(d)} />))}
          {tab === 'trade' && (tradeNotes.length === 0
            ? <p className="jr-empty">No trade notes yet. Add notes from a trade's Notes tab.</p>
            : tradeNotes.map((t) => {
                const n = netPnl(t)
                return (
                  <button key={t.id} className={`jr-card ${t.id === current ? 'active' : ''}`} onClick={() => select(t.id)}>
                    <div className="jr-card-top"><span className="sym">{t.symbol}</span><span className="muted">{shortDate(dayKey(tradeTime(t)))}</span><span className="spacer" /><b className={pnlClass(n)}>{fmtMoney(n, false)}</b></div>
                    <p className="jr-snip">{preview(t.notes)}</p>
                  </button>
                )
              }))}
          {tab === 'general' && (general.length === 0
            ? <p className="jr-empty">No general notes yet. Use "New note +".</p>
            : general.map((n) => (
                <button key={n.id} className={`jr-card ${n.id === current ? 'active' : ''}`} onClick={() => select(n.id)}>
                  <div className="jr-card-top"><b>{n.title || 'Untitled note'}</b><span className="spacer" /><span className="muted">{new Date(n.updated_at).toLocaleDateString(undefined, { dateStyle: 'medium' })}</span></div>
                  {n.body && <p className="jr-snip">{preview(n.body)}</p>}
                </button>
              )))}
        </div>

        <section className="jr-main">
          {!loaded ? (
            <div className="jr-placeholder"><span>Loading notes…</span></div>
          ) : tab === 'daily' && current ? (
            <DailyPane
              key={current}
              day={current}
              note={daily.get(current)}
              trades={byDay.get(current) ?? []}
              openTrade={openTrade}
              onSaved={(n) => setNotes((list) => [n, ...list.filter((x) => x.id !== n.id)])}
              onError={(e) => setError(journalError(e))}
            />
          ) : tab === 'trade' && current && trades.find((t) => t.id === current) ? (
            <TradeNotePane key={current} trade={trades.find((t) => t.id === current)!} reload={reload} openTrade={openTrade} onError={setError} />
          ) : tab === 'general' && current && general.find((n) => n.id === current) ? (
            <GeneralPane
              key={current}
              note={general.find((n) => n.id === current)!}
              onChange={(patch) => setNotes((list) => list.map((x) => (x.id === current ? { ...x, ...patch, updated_at: new Date().toISOString() } : x)))}
              onDeleted={() => { setNotes((list) => list.filter((x) => x.id !== current)); select(null) }}
              onError={(e) => setError(journalError(e))}
            />
          ) : (
            <div className="jr-placeholder">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></svg>
              <span>{tab === 'trade' ? 'Select a trade to view its notes' : 'Select a note or create a new one'}</span>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function Sparkline({ trades }: { trades: Trade[] }) {
  const pts = [...trades].sort((a, b) => tradeTime(a).getTime() - tradeTime(b).getTime())
  let eq = 0
  const ys = [0, ...pts.map((t) => (eq += netPnl(t)))]
  const min = Math.min(...ys), max = Math.max(...ys)
  const span = max - min || 1
  const W = 120, H = 32
  const line = ys.map((y, i) => `${(i / Math.max(1, ys.length - 1)) * W},${H - 2 - ((y - min) / span) * (H - 4)}`).join(' ')
  const up = eq >= 0
  return (
    <svg className="jr-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
      <polygon points={`0,${H} ${line} ${W},${H}`} fill={up ? 'rgba(79,185,133,0.15)' : 'rgba(225,91,79,0.15)'} />
      <polyline points={line} fill="none" stroke={up ? 'var(--win)' : 'var(--loss)'} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function DayCard({ day, trades, hasNote, active, onClick }: { day: string; trades: Trade[]; hasNote: boolean; active: boolean; onClick: () => void }) {
  const s = summarize(trades)
  const pf = s.profitFactor === Infinity ? '∞' : s.profitFactor ? s.profitFactor.toFixed(2) : '—'
  return (
    <button className={`jr-card jr-day ${active ? 'active' : ''}`} onClick={onClick}>
      <div className="jr-day-head">
        <div>
          <div className="jr-day-date">{shortDate(day)} {hasNote && <span className="jr-dot" title="Has a note" />}</div>
          <b className={`jr-day-pnl ${pnlClass(s.net)}`}>{trades.length ? fmtMoney(s.net, false) : 'No trades'}</b>
        </div>
        {trades.length > 0 && <Sparkline trades={trades} />}
      </div>
      {trades.length > 0 && (
        <div className="jr-day-stats">
          <dl className="kv"><dt>Commissions</dt><dd>{fmtMoney(s.fees, false)}</dd><dt>Trades</dt><dd>{s.count}</dd></dl>
          <dl className="kv"><dt>Win %</dt><dd>{Math.round(s.winRate * 100)}%</dd><dt>Profit factor</dt><dd>{pf}</dd></dl>
        </div>
      )}
    </button>
  )
}

function DailyPane({ day, note, trades, openTrade, onSaved, onError }: { day: string; note?: JournalNote; trades: Trade[]; openTrade: (id: string) => void; onSaved: (n: JournalNote) => void; onError: (e: unknown) => void }) {
  const sorted = [...trades].sort((a, b) => tradeTime(a).getTime() - tradeTime(b).getTime())
  return (
    <div className="jr-pane">
      <div className="jr-pane-head">
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
        <h2>{longDate(day)}</h2>
      </div>
      <NoteEditor
        value={note?.body ?? null}
        placeholder="How did today go? What did you see in the market, and what will you do differently tomorrow?"
        onSave={async (body) => {
          try {
            onSaved(await saveDailyNote(day, body))
            return true
          } catch (e) {
            onError(e)
            return false
          }
        }}
      />
      {sorted.length > 0 && (
        <div className="jr-trades table-wrap">
          <table>
            <thead><tr><th>Status</th><th>Open time</th><th>Symbol</th><th>Side</th><th className="num">Entry</th><th className="num">Exit</th><th className="num">Size</th><th className="num">Net P&amp;L $</th><th className="num">Return %</th><th className="num">Fees</th><th>Close time</th></tr></thead>
            <tbody>
              {sorted.map((t) => {
                const n = netPnl(t)
                const r = tradeReturn(t)
                const st = tradeStatus(t)
                return (
                  <tr key={t.id} onClick={() => openTrade(t.id)} title="Open trade">
                    <td className={`c-status st-${st.toLowerCase()}`}>{st}</td>
                    <td>{time(t.opened_at)}</td>
                    <td><span className="sym">{t.symbol}</span></td>
                    <td><span className={`side-badge ${t.side === 'short' ? 'short' : 'long'}`}>{t.side ? t.side[0].toUpperCase() : '–'}</span></td>
                    <td className="num">{fmtNum(t.entry_price)}</td>
                    <td className="num">{fmtNum(t.exit_price)}</td>
                    <td className="num">{fmtNum(t.size)}</td>
                    <td className={`num ${pnlClass(n)}`}>{fmtMoney(n, false)}</td>
                    <td className={`num ${pnlClass(n)}`}>{r == null ? '—' : `${(r * 100).toFixed(2)}%`}</td>
                    <td className="num">{fmtMoney(Number(t.fees) || 0, false)}</td>
                    <td>{time(t.closed_at)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="tl-foot"><span>Total trades: {sorted.length}</span></div>
        </div>
      )}
    </div>
  )
}

function TradeNotePane({ trade, reload, openTrade, onError }: { trade: Trade; reload: () => void; openTrade: (id: string) => void; onError: (msg: string) => void }) {
  const n = netPnl(trade)
  return (
    <div className="jr-pane">
      <div className="jr-pane-head">
        <span className="sym">{trade.symbol}</span>
        <h2>{shortDate(dayKey(tradeTime(trade)))}</h2>
        <b className={pnlClass(n)}>{fmtMoney(n, false)}</b>
        <span className="spacer" />
        <button className="chip-btn" onClick={() => openTrade(trade.id)}>Open trade →</button>
      </div>
      <NoteEditor
        value={trade.notes}
        onSave={async (notes) => {
          try {
            await updateTrade(trade.id, { notes })
            reload()
            return true
          } catch (e) {
            onError(friendlySaveError(e))
            return false
          }
        }}
      />
    </div>
  )
}

function GeneralPane({ note, onChange, onDeleted, onError }: { note: JournalNote; onChange: (p: Partial<JournalNote>) => void; onDeleted: () => void; onError: (e: unknown) => void }) {
  const [title, setTitle] = useState(note.title ?? '')
  async function saveTitle() {
    const t = title.trim() || 'Untitled note'
    if (t === note.title) return
    try {
      await updateJournalNote(note.id, { title: t })
      onChange({ title: t })
    } catch (e) {
      onError(e)
    }
  }
  async function remove() {
    if (!confirm(`Delete "${note.title || 'Untitled note'}"? This cannot be undone.`)) return
    try {
      await deleteJournalNote(note.id)
      onDeleted()
    } catch (e) {
      onError(e)
    }
  }
  return (
    <div className="jr-pane">
      <div className="jr-pane-head">
        <input className="jr-title" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={saveTitle} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} aria-label="Note title" />
        <button className="chip-btn danger" onClick={remove}>Delete</button>
      </div>
      <NoteEditor
        value={note.body}
        onSave={async (body) => {
          try {
            await updateJournalNote(note.id, { body })
            onChange({ body })
            return true
          } catch (e) {
            onError(e)
            return false
          }
        }}
      />
    </div>
  )
}
