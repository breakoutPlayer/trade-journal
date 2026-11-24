import { useState } from 'react'
import type { Trade, TradeInput } from '../lib/types'
import { parseCsv, splitDuplicates, type Exchange, type ImportResult } from '../lib/importers'
import { insertTrades, netPnl } from '../lib/trades'
import { fmtDateTime, fmtMoney, fmtNum, parseTags, pnlClass } from '../lib/format'

interface Props {
  trades: Trade[]
  reload: () => void
}

export function Import({ trades, reload }: Props) {
  const [choice, setChoice] = useState<Exchange | 'auto'>('auto')
  const [fileName, setFileName] = useState('')
  const [text, setText] = useState('')
  const [feesInPnl, setFeesInPnl] = useState(false)
  const [tags, setTags] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')

  // Parse on every render from the raw text, so changing the exchange or checkbox updates the preview.
  let result: ImportResult | null = null
  let error = ''
  if (text) {
    try {
      result = parseCsv(text, choice)
    } catch (e) {
      error = (e as Error).message
    }
  }

  const extraTags = parseTags(tags)
  const prepared: TradeInput[] = (result?.trades ?? []).map((t) => ({
    ...t,
    // Our pnl column is gross. If the file's P&L is already net of fees, add fees back.
    pnl: feesInPnl ? (t.pnl ?? 0) + (t.fees ?? 0) : t.pnl,
    tags: extraTags,
  }))
  const { fresh, dupes } = splitDuplicates(prepared, trades)
  const totalNet = fresh.reduce((s, t) => s + netPnl(t), 0)

  async function onFile(file: File | undefined) {
    setDone('')
    if (!file) return
    setFileName(file.name)
    setText(await file.text())
  }

  async function save() {
    setBusy(true)
    try {
      await insertTrades(fresh)
      setDone(`Imported ${fresh.length} trade(s).`)
      setText('')
      setFileName('')
      reload()
    } catch (e) {
      alert((e as Error).message)
    }
    setBusy(false)
  }

  return (
    <>
      <h1>Import CSV</h1>
      <div className="panel">
        <div className="grid-form stack-sm">
          <label>
            Exchange
            <select value={choice} onChange={(e) => setChoice(e.target.value as Exchange | 'auto')}>
              <option value="auto">Detect automatically</option>
              <option value="hyperliquid">Hyperliquid (Trade History)</option>
              <option value="bitunix">Bitunix (Position History)</option>
            </select>
          </label>
          <label>
            CSV file
            <input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          <label>
            Tags to add to every imported trade
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="imported, nov" />
          </label>
          <label className="wide check-row">
            <input type="checkbox" style={{ width: 'auto' }} checked={feesInPnl} onChange={(e) => setFeesInPnl(e.target.checked)} />
            The P&amp;L column in this file already has fees subtracted
          </label>
        </div>
        <p className="mb-0">
          Hyperliquid: Portfolio → Trade History → Export as CSV. Fills are grouped into complete trades automatically.
          <br />
          Bitunix: Futures → Position History → Export.
        </p>
      </div>

      {done && <div className="panel notice">{done}</div>}
      {error && <div className="panel error">{error}</div>}

      {result && (
        <div className="panel">
          <div className="row mb-12">
            <h2 className="m-0">Preview: {fileName}</h2>
            <span className="spacer" />
            <span className="muted">
              {fresh.length} new · {dupes} duplicate(s) skipped · net{' '}
              <span className={pnlClass(totalNet)}>{fmtMoney(totalNet)}</span>
            </span>
            <button className="primary" disabled={busy || fresh.length === 0} onClick={save}>
              {busy ? 'Importing…' : `Import ${fresh.length} trade(s)`}
            </button>
          </div>
          {result.warnings.map((w) => (
            <p key={w} className="muted my-4">{w}</p>
          ))}
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
                  <th className="num">Fees</th>
                  <th className="num">Net P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {fresh.slice(0, 100).map((t, i) => (
                  <tr key={i}>
                    <td>{fmtDateTime(t.closed_at)}</td>
                    <td>{t.symbol}</td>
                    <td>{t.side ?? '—'}</td>
                    <td className="num">{fmtNum(t.size)}</td>
                    <td className="num">{fmtNum(t.entry_price)}</td>
                    <td className="num">{fmtNum(t.exit_price)}</td>
                    <td className="num">{fmtNum(t.fees)}</td>
                    <td className={`num ${pnlClass(netPnl(t))}`}>{fmtMoney(netPnl(t))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {fresh.length > 100 && <p>Showing the first 100 of {fresh.length}.</p>}
        </div>
      )}
    </>
  )
}
