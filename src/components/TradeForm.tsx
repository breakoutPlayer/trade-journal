import { useState, type FormEvent } from 'react'
import type { Trade, TradeInput } from '../lib/types'
import { insertTrades, updateTrade } from '../lib/trades'
import { fromLocalInput, parseTags, toLocalInput } from '../lib/format'

interface Props {
  trade?: Trade // when present we're editing
  onDone: () => void
  onCancel: () => void
}

const num = (v: string) => (v.trim() === '' ? null : Number(v))
const str = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v))

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
    tags: (trade?.tags ?? []).join(', '),
  })
  const [busy, setBusy] = useState(false)
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
      tags: parseTags(f.tags),
    }
    try {
      if (trade) await updateTrade(trade.id, row)
      else await insertTrades([row])
      onDone()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
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
            Tags (comma separated)
            <input value={f.tags} onChange={set('tags')} placeholder="breakout, a+ setup" />
          </label>
          <label className="wide">Notes<textarea rows={4} value={f.notes} onChange={set('notes')} /></label>
          {error && <div className="error wide">{error}</div>}
          <div className="row wide">
            <span className="spacer" />
            <button type="button" onClick={onCancel}>Cancel</button>
            <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
