import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Trade, TradeInput } from '../lib/types'
import { insertTrades, updateTrade } from '../lib/trades'
import { removeCharts, uploadChart } from '../lib/charts'
import { ChartPicker, type PendingChart } from './Charts'
import { fromLocalInput, toLocalInput } from '../lib/format'
import { useTradingTools } from '../lib/settings'

interface Props {
  trade?: Trade // when present we're editing
  onDone: () => void
  onCancel: () => void
}

const num = (v: string) => (v.trim() === '' ? null : Number(v))
const str = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v))
const MULTI = '\u0000multi' // older trades with several setup tags keep them until one is picked

export function TradeForm({ trade, onDone, onCancel }: Props) {
  const [f, setF] = useState({
    symbol: trade?.symbol ?? '',
    side: trade?.side ?? 'long',
    entry_price: str(trade?.entry_price),
    exit_price: str(trade?.exit_price),
    size: str(trade?.size),
    pnl: str(trade?.pnl),
    fees: str(trade?.fees ?? 0),
    exchange: trade?.exchange ?? '',
    opened_at: toLocalInput(trade?.opened_at ?? null),
    closed_at: toLocalInput(trade?.closed_at ?? null),
    notes: trade?.notes ?? '',
    setup: (trade?.tags?.length ?? 0) > 1 ? MULTI : (trade?.tags?.[0] ?? ''),
  })
  const tools = useTradingTools()
  const setupOptions = [...new Set([
    ...tools.labels.filter((l) => l.kind === 'setup').map((l) => l.name),
    ...((trade?.tags?.length ?? 0) === 1 ? trade!.tags! : []),
  ])].sort((a, b) => a.localeCompare(b))
  const [savedCharts, setSavedCharts] = useState<string[]>(trade?.charts ?? [])
  const [pending, setPending] = useState<PendingChart[]>([])
  const [busy, setBusy] = useState(false)

  // Free the in-memory previews when the form closes.
  const pendingRef = useRef(pending)
  useEffect(() => {
    pendingRef.current = pending
  }, [pending])
  useEffect(() => () => pendingRef.current.forEach((p) => URL.revokeObjectURL(p.preview)), [])
  const [error, setError] = useState('')
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })

  // If P&L is left blank but prices + size are filled, work it out.
  const entry = num(f.entry_price)
  const exit = num(f.exit_price)
  const size = num(f.size)
  const autoPnl =
    entry !== null && exit !== null && size !== null ? (exit - entry) * size * (f.side === 'short' ? -1 : 1) : null

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const row: TradeInput = {
      symbol: f.symbol.trim().toUpperCase(),
      side: f.side as 'long' | 'short',
      entry_price: entry,
      exit_price: exit,
      size,
      pnl: f.pnl.trim() === '' ? autoPnl : Number(f.pnl),
      fees: num(f.fees) ?? 0,
      exchange: f.exchange.trim() || null,
      opened_at: fromLocalInput(f.opened_at),
      closed_at: fromLocalInput(f.closed_at),
      notes: f.notes.trim() || null,
      tags: f.setup === MULTI ? (trade?.tags ?? []) : f.setup ? [f.setup] : [],
    }
    const uploaded: string[] = []
    try {
      for (const p of pending) uploaded.push(await uploadChart(p.file))
      row.charts = [...savedCharts, ...uploaded]
      if (trade) await updateTrade(trade.id, row)
      else await insertTrades([row])
    } catch (err) {
      // Don't leave orphaned files behind if the trade itself didn't save.
      removeCharts(uploaded).catch(() => {})
      setError((err as Error).message)
      setBusy(false)
      return
    }
    // The trade no longer points at charts the user removed, so delete the files.
    const dropped = (trade?.charts ?? []).filter((c) => !savedCharts.includes(c))
    removeCharts(dropped).catch(() => {})
    onDone()
  }

  return (
    <div className="modal-bg" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{trade ? 'Edit trade' : 'New trade'}</h2>
        <form onSubmit={submit} className="grid-form">
          <label>Symbol<input required value={f.symbol} onChange={set('symbol')} placeholder="BTC" /></label>
          <label>
            Side
            <select value={f.side} onChange={set('side')}>
              <option value="long">Long</option>
              <option value="short">Short</option>
            </select>
          </label>
          <label>Exchange<input value={f.exchange} onChange={set('exchange')} placeholder="Hyperliquid" /></label>
          <label>Size<input type="number" step="any" value={f.size} onChange={set('size')} /></label>
          <label>Entry price<input type="number" step="any" value={f.entry_price} onChange={set('entry_price')} /></label>
          <label>Exit price<input type="number" step="any" value={f.exit_price} onChange={set('exit_price')} /></label>
          <label>
            P&amp;L (gross)
            <input
              type="number"
              step="any"
              value={f.pnl}
              onChange={set('pnl')}
              placeholder={autoPnl !== null ? `auto: ${autoPnl.toFixed(2)}` : ''}
            />
          </label>
          <label>Fees<input type="number" step="any" value={f.fees} onChange={set('fees')} /></label>
          <label>Opened<input type="datetime-local" value={f.opened_at} onChange={set('opened_at')} /></label>
          <label>Closed<input type="datetime-local" value={f.closed_at} onChange={set('closed_at')} /></label>
          <label className="wide">
            Setup
            <select value={f.setup} onChange={set('setup')}>
              {(trade?.tags?.length ?? 0) > 1 && <option value={MULTI}>Multiple: {(trade?.tags ?? []).join(', ')} (kept)</option>}
              <option value="">No setup</option>
              {setupOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="wide">Notes<textarea rows={4} value={f.notes} onChange={set('notes')} /></label>
          <ChartPicker
            saved={savedCharts}
            pending={pending}
            onRemoveSaved={(path) => setSavedCharts(savedCharts.filter((c) => c !== path))}
            onAdd={(files) => setPending((prev) => [...prev, ...files])}
            onRemovePending={(p) => {
              URL.revokeObjectURL(p.preview)
              setPending((prev) => prev.filter((x) => x !== p))
            }}
          />
          {error && <div className="error wide">{error}</div>}
          <div className="row wide">
            <span className="spacer" />
            <button type="button" onClick={onCancel}>Cancel</button>
            <button className="primary" disabled={busy}>{busy ? (pending.length ? 'Uploading…' : 'Saving…') : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
