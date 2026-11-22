import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import type { Trade, TradeInput } from '../lib/types'
import { deleteTrade, friendlySaveError, netPnl, tradeReturn, tradeStatus, updateTrade } from '../lib/trades'
import { checkChartFile, removeCharts, uploadChart, useChartUrls } from '../lib/charts'
import { fmtDateTime, fmtMoney, fmtNum, pnlClass } from '../lib/format'
import { Lightbox } from '../components/Charts'
import { NoteEditor } from '../components/NoteEditor'

type Tab = 'overview' | 'strategy' | 'risk' | 'notes'
const TABS: [Tab, string][] = [['overview', 'Overview'], ['strategy', 'Strategy'], ['risk', 'Risk'], ['notes', 'Notes']]

interface Props {
  trade: Trade
  allSetups: string[]
  allMistakes: string[]
  reload: () => void
  onBack: () => void
  onEdit: () => void
  onDeleted: () => void
  prev?: () => void
  next?: () => void
}

/** Full-page view of one trade: tabs on the left, chart screenshots on the right (TraderSync style). */
export function TradeDetail({ trade, allSetups, allMistakes, reload, onBack, onEdit, onDeleted, prev, next }: Props) {
  const [tab, setTab] = useState<Tab>('overview')
  const [adding, setAdding] = useState<'target' | 'stop' | null>(null)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)

  async function save(patch: Partial<TradeInput>) {
    setError('')
    try {
      await updateTrade(trade.id, patch)
      reload()
      return true
    } catch (err) {
      setError(friendlySaveError(err))
      return false
    }
  }

  async function addCharts(files: File[]) {
    const images = files.filter((f) => f.type.startsWith('image/'))
    if (!images.length) return
    const bad = images.map(checkChartFile).find(Boolean)
    if (bad) return setError(bad)
    setUploading(true)
    setError('')
    const uploaded: string[] = []
    try {
      for (const f of images) uploaded.push(await uploadChart(f))
      if (!(await save({ charts: [...(trade.charts ?? []), ...uploaded] }))) removeCharts(uploaded).catch(() => {})
    } catch (err) {
      removeCharts(uploaded).catch(() => {})
      setError((err as Error).message)
    }
    setUploading(false)
  }

  async function removeChart(path: string) {
    if (!confirm('Remove this chart screenshot?')) return
    if (await save({ charts: (trade.charts ?? []).filter((c) => c !== path) })) removeCharts([path]).catch(() => {})
  }

  async function remove() {
    if (!confirm(`Delete this ${trade.symbol} trade? This cannot be undone.`)) return
    try {
      await deleteTrade(trade.id)
      removeCharts(trade.charts ?? []).catch(() => {})
      onDeleted()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  // Paste a screenshot anywhere on the page to attach it.
  const addRef = useRef(addCharts)
  useEffect(() => { addRef.current = addCharts })
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'))
      if (files.length) {
        e.preventDefault()
        addRef.current(files)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  const goRisk = (kind: 'target' | 'stop') => {
    setAdding(kind)
    setTab('risk')
  }

  return (
    <div className="td">
      <div className="td-top">
        <button className="chip-btn" onClick={onBack}>← Trades</button>
        <span className="sym">{trade.symbol}</span>
        <span className="muted td-when">{fmtDateTime(trade.opened_at ?? trade.closed_at)}</span>
        <span className="spacer" />
        <button className="icon-btn" disabled={!prev} onClick={prev} title="Previous trade" aria-label="Previous trade">‹</button>
        <button className="icon-btn" disabled={!next} onClick={next} title="Next trade" aria-label="Next trade">›</button>
        <button className="chip-btn" onClick={onEdit}>Edit</button>
        <button className="chip-btn danger" onClick={remove}>Delete</button>
      </div>
      {error && <div className="panel error td-error">{error}</div>}

      <div className="td-body">
        <aside className="td-side">
          <div className="td-tabs" role="tablist">
            {TABS.map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>
            ))}
          </div>
          {tab === 'overview' && <Overview trade={trade} allSetups={allSetups} allMistakes={allMistakes} save={save} goRisk={goRisk} />}
          {tab === 'strategy' && <Strategy trade={trade} allSetups={allSetups} allMistakes={allMistakes} save={save} />}
          {tab === 'risk' && <Risk trade={trade} save={save} adding={adding} clearAdding={() => setAdding(null)} />}
          {tab === 'notes' && <Notes key={trade.id} trade={trade} save={save} onImages={addCharts} uploading={uploading} />}
        </aside>
        <ChartPane trade={trade} onFiles={addCharts} onRemove={removeChart} uploading={uploading} />
      </div>
    </div>
  )
}

type Save = (patch: Partial<TradeInput>) => Promise<boolean>

function Section({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="td-sec">
      <button className="td-sec-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>{title}</span><span className="chev">{open ? '⌄' : '›'}</span>
      </button>
      {open && <div className="td-sec-body">{children}</div>}
    </section>
  )
}

function Overview({ trade, allSetups, allMistakes, save, goRisk }: { trade: Trade; allSetups: string[]; allMistakes: string[]; save: Save; goRisk: (k: 'target' | 'stop') => void }) {
  const n = netPnl(trade)
  const r = tradeReturn(trade)
  const st = tradeStatus(trade)
  const size = Number(trade.size) || 0
  const cost = Math.abs((Number(trade.entry_price) || 0) * size)
  return (
    <>
      <Section title="Trade summary">
        <div className="td-summary">
          <span className="label">PnL net $</span>
          <div className="td-big">
            <b className={pnlClass(n)}>{st === 'OPEN' ? 'Open' : fmtMoney(n, false)}</b>
            {st !== 'OPEN' && <span className={`td-arrow ${n >= 0 ? 'up' : 'down'}`}>{n >= 0 ? '↗' : '↘'}</span>}
          </div>
          <div className="td-badges">
            {trade.side && <span className={`side-badge ${trade.side}`}>{trade.side[0].toUpperCase()}</span>}
            <span className="tbadge">{st}</span>
            {r != null && st !== 'OPEN' && <span className={`tbadge ${n >= 0 ? 'pos-soft' : 'neg-soft'}`}>{n >= 0 ? '+' : ''}{(r * 100).toFixed(1)}%</span>}
          </div>
        </div>
        <div className="td-kv2">
          <dl className="kv">
            <dt>Size</dt><dd>{fmtNum(trade.size)}</dd>
            <dt>Cost</dt><dd>{cost ? fmtMoney(cost, false) : '—'}</dd>
            <dt>Avg entry</dt><dd>{fmtNum(trade.entry_price)}</dd>
            <dt>Avg exit</dt><dd>{fmtNum(trade.exit_price)}</dd>
          </dl>
          <dl className="kv">
            <dt>PnL gross $</dt><dd className={pnlClass(Number(trade.pnl) || 0)}>{trade.pnl == null ? '—' : fmtMoney(Number(trade.pnl), false)}</dd>
            <dt>Commission</dt><dd>{fmtMoney(Number(trade.fees) || 0, false)}</dd>
            <dt>PnL $ / size</dt><dd>{size && st !== 'OPEN' ? fmtMoney(n / size, false) : '—'}</dd>
            <dt>Portfolio</dt><dd>{trade.exchange || '—'}</dd>
          </dl>
        </div>
        <div className="td-two">
          <button className="chip-btn" onClick={() => goRisk('target')}>+ Add target</button>
          <button className="chip-btn" onClick={() => goRisk('stop')}>+ Add stop</button>
        </div>
      </Section>
      <Section title="Setups">
        <ChipEditor kind="setup" values={trade.tags ?? []} suggestions={allSetups} onChange={(tags) => save({ tags })} />
      </Section>
      <Section title="Mistakes">
        <ChipEditor kind="mistake" values={trade.mistakes ?? []} suggestions={allMistakes} onChange={(mistakes) => save({ mistakes })} />
      </Section>
    </>
  )
}

function fmtDuration(ms: number) {
  const m = Math.round(ms / 60000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h ${m % 60}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

function Strategy({ trade, allSetups, allMistakes, save }: { trade: Trade; allSetups: string[]; allMistakes: string[]; save: Save }) {
  const hold = trade.opened_at && trade.closed_at ? new Date(trade.closed_at).getTime() - new Date(trade.opened_at).getTime() : null
  return (
    <>
      <Section title="Execution">
        <dl className="kv">
          <dt>Side</dt><dd style={{ textTransform: 'capitalize' }}>{trade.side ?? '—'}</dd>
          <dt>Opened</dt><dd>{fmtDateTime(trade.opened_at)}</dd>
          <dt>Closed</dt><dd>{fmtDateTime(trade.closed_at)}</dd>
          <dt>Hold time</dt><dd>{hold != null && hold >= 0 ? fmtDuration(hold) : '—'}</dd>
          <dt>Portfolio</dt><dd>{trade.exchange || '—'}</dd>
        </dl>
      </Section>
      <Section title="Setups">
        <ChipEditor kind="setup" values={trade.tags ?? []} suggestions={allSetups} onChange={(tags) => save({ tags })} />
      </Section>
      <Section title="Mistakes">
        <ChipEditor kind="mistake" values={trade.mistakes ?? []} suggestions={allMistakes} onChange={(mistakes) => save({ mistakes })} />
      </Section>
    </>
  )
}

/** Chips with × to remove and an inline "+ Add" box with suggestions from other trades. */
function ChipEditor({ kind, values, suggestions, onChange }: { kind: 'setup' | 'mistake'; values: string[]; suggestions: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const listId = `dl-${kind}`
  const add = () => {
    const v = text.trim().toLowerCase()
    if (v && !values.includes(v)) onChange([...values, v])
    setText('')
    setOpen(false)
  }
  return (
    <div className="chips">
      {values.map((v) => (
        <span key={v} className={`chip ${kind}`}>
          {v}
          <button aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}>×</button>
        </span>
      ))}
      {open ? (
        <form className="chip-add" onSubmit={(e) => { e.preventDefault(); add() }}>
          <input autoFocus list={listId} value={text} onChange={(e) => setText(e.target.value)} placeholder={kind === 'setup' ? 'e.g. breakout' : 'e.g. fomo entry'} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} onBlur={() => (text.trim() ? add() : setOpen(false))} />
          <datalist id={listId}>{suggestions.filter((s) => !values.includes(s)).map((s) => <option key={s} value={s} />)}</datalist>
        </form>
      ) : (
        <button className="chip-btn" onClick={() => setOpen(true)}>+ Add {kind}</button>
      )}
    </div>
  )
}

function Risk({ trade, save, adding, clearAdding }: { trade: Trade; save: Save; adding: 'target' | 'stop' | null; clearAdding: () => void }) {
  const entry = trade.entry_price == null ? null : Number(trade.entry_price)
  const size = Math.abs(Number(trade.size) || 0)
  const targets = trade.targets ?? []
  const stops = trade.stops ?? []
  const n = netPnl(trade)
  const riskPer = entry != null && stops.length ? Math.abs(entry - Number(stops[0])) : null
  const riskUsd = riskPer != null && size ? riskPer * size : null
  const rewardPer = entry != null && targets.length ? Math.abs(Number(targets[0]) - entry) : null
  const closed = tradeStatus(trade) !== 'OPEN'
  return (
    <>
      <Section title="Targets">
        <PriceList kind="target" entry={entry} size={size} values={targets} startOpen={adding === 'target'} onOpened={clearAdding} onChange={(v) => save({ targets: v })} />
      </Section>
      <Section title="Stops">
        <PriceList kind="stop" entry={entry} size={size} values={stops} startOpen={adding === 'stop'} onOpened={clearAdding} onChange={(v) => save({ stops: v })} />
      </Section>
      {(riskUsd != null || rewardPer != null) && (
        <Section title="Risk / reward">
          <dl className="kv">
            <dt>Initial risk $</dt><dd>{riskUsd != null ? fmtMoney(riskUsd, false) : '—'}</dd>
            <dt>Planned R:R</dt><dd>{riskPer && rewardPer != null ? `1 : ${(rewardPer / riskPer).toFixed(2)}` : '—'}</dd>
            <dt>Realized R</dt><dd className={pnlClass(n)}>{riskUsd && closed ? `${(n / riskUsd).toFixed(2)}R` : '—'}</dd>
          </dl>
        </Section>
      )}
    </>
  )
}

function PriceList({ kind, entry, size, values, startOpen, onOpened, onChange }: { kind: 'target' | 'stop'; entry: number | null; size: number; values: number[]; startOpen: boolean; onOpened: () => void; onChange: (v: number[]) => void }) {
  const [open, setOpen] = useState(startOpen)
  const [text, setText] = useState('')
  useEffect(() => {
    if (startOpen) {
      setOpen(true)
      onOpened()
    }
  }, [startOpen, onOpened])
  const add = () => {
    const v = Number(text)
    if (text.trim() && Number.isFinite(v)) onChange([...values, v])
    setText('')
    setOpen(false)
  }
  return (
    <div className="prices">
      {values.map((p, i) => {
        const diff = entry != null ? Number(p) - entry : null
        return (
          <div key={i} className="price-row">
            <b>{fmtNum(p)}</b>
            {diff != null && (
              <span className="muted">
                {entry ? `${diff >= 0 ? '+' : ''}${((diff / entry) * 100).toFixed(2)}%` : ''}
                {size ? ` · ${fmtMoney(Math.abs(diff) * size, false)}` : ''}
              </span>
            )}
            <button aria-label={`Remove ${kind}`} onClick={() => onChange(values.filter((_, j) => j !== i))}>×</button>
          </div>
        )
      })}
      {open ? (
        <form className="chip-add" onSubmit={(e) => { e.preventDefault(); add() }}>
          <input autoFocus type="number" step="any" value={text} onChange={(e) => setText(e.target.value)} placeholder={`${kind === 'target' ? 'Target' : 'Stop'} price`} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} onBlur={() => (text.trim() ? add() : setOpen(false))} />
        </form>
      ) : (
        <button className="chip-btn" onClick={() => setOpen(true)}>+ Add {kind}</button>
      )}
    </div>
  )
}

const PLACEHOLDER = 'Why did you take this trade?\nDid you follow your rules?\nNote any emotions, chart patterns or trade management lessons learned.'

function Notes({ trade, save, onImages, uploading }: { trade: Trade; save: Save; onImages: (f: File[]) => void; uploading: boolean }) {
  const file = useRef<HTMLInputElement>(null)
  return (
    <>
      <Section title="Trade notes">
        <NoteEditor value={trade.notes} placeholder={PLACEHOLDER} onSave={(notes) => save({ notes })} />
      </Section>
      <button className="td-dashed" disabled={uploading} onClick={() => file.current?.click()}>{uploading ? 'Uploading…' : 'Add image +'}</button>
      <input ref={file} type="file" accept="image/*" multiple hidden onChange={(e) => { onImages([...(e.target.files ?? [])]); e.target.value = '' }} />
    </>
  )
}

// ---------- Charts ----------

function ChartPane({ trade, onFiles, onRemove, uploading }: { trade: Trade; onFiles: (f: File[]) => void; onRemove: (p: string) => void; uploading: boolean }) {
  const paths = trade.charts ?? []
  const { urls, error } = useChartUrls(paths)
  const [idx, setIdx] = useState(0)
  const [zoom, setZoom] = useState(false)
  const [over, setOver] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const cur = paths[Math.min(idx, paths.length - 1)]

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    onFiles([...e.dataTransfer.files])
  }

  return (
    <section
      className={`td-chart ${over ? 'over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      {error && <div className="error">{error}</div>}
      {cur ? (
        <>
          <div className="td-main-img">
            {urls[cur] ? <img src={urls[cur]} alt={`${trade.symbol} chart`} onClick={() => setZoom(true)} /> : <span className="muted">Loading…</span>}
            <button className="td-img-remove" title="Remove this chart" onClick={() => onRemove(cur)}>×</button>
          </div>
          <div className="td-strip">
            {paths.map((p, i) => (
              <button key={p} className={`td-thumb ${p === cur ? 'active' : ''}`} onClick={() => setIdx(i)} aria-label={`Chart ${i + 1}`}>
                {urls[p] ? <img src={urls[p]} alt="" /> : null}
              </button>
            ))}
            <button className="td-thumb add" disabled={uploading} onClick={() => file.current?.click()} title="Add chart">{uploading ? '…' : '+'}</button>
          </div>
        </>
      ) : (
        <button className="td-empty" disabled={uploading} onClick={() => file.current?.click()}>
          <b>{uploading ? 'Uploading…' : 'Add a chart screenshot'}</b>
          <span className="muted">Click to choose, drop an image here, or paste with Ctrl+V</span>
        </button>
      )}
      <input ref={file} type="file" accept="image/*" multiple hidden onChange={(e) => { onFiles([...(e.target.files ?? [])]); e.target.value = '' }} />
      {zoom && cur && urls[cur] && <Lightbox src={urls[cur]} onClose={() => setZoom(false)} />}
    </section>
  )
}
