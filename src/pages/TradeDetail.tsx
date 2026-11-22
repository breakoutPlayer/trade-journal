import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import type { Trade, TradeInput } from '../lib/types'
import { deleteTrade, friendlySaveError, netPnl, tradeReturn, tradeStatus, updateTrade } from '../lib/trades'
import { checkChartFile, removeCharts, uploadChart, useChartUrls } from '../lib/charts'
import { fmtDateTime, fmtMoney, fmtNum, pnlClass } from '../lib/format'
import { Lightbox } from '../components/Charts'
import { NoteEditor } from '../components/NoteEditor'
import { PriceChart } from '../components/PriceChart'
import { customTag, useTradingTools, type Strategy as StrategyDef, type TagCategory } from '../lib/settings'

type Tab = 'overview' | 'strategy' | 'notes'
const TABS: [Tab, string][] = [['overview', 'Overview'], ['strategy', 'Strategy'], ['notes', 'Notes']]

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
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const tools = useTradingTools()
  const defined = (kind: 'setup' | 'mistake') => tools.labels.filter((l) => l.kind === kind).map((l) => l.name)
  const setups = [...new Set([...defined('setup'), ...allSetups])]
  const mistakes = [...new Set([...defined('mistake'), ...allMistakes])]

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
          {tab === 'overview' && <Overview trade={trade} allSetups={setups} allMistakes={mistakes} save={save} />}
          {tab === 'strategy' && <Strategy trade={trade} allSetups={setups} allMistakes={mistakes} save={save} strategies={tools.strategies} categories={tools.categories} />}
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

function Overview({ trade, allSetups, allMistakes, save }: { trade: Trade; allSetups: string[]; allMistakes: string[]; save: Save }) {
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
        <div className="td-two td-levels">
          <div>
            <span className="label">Target</span>
            <PriceList kind="target" entry={trade.entry_price == null ? null : Number(trade.entry_price)} size={Math.abs(size)} values={trade.targets ?? []} startOpen={false} onOpened={noop} onChange={(v) => save({ targets: v })} />
          </div>
          <div>
            <span className="label">Stop</span>
            <PriceList kind="stop" entry={trade.entry_price == null ? null : Number(trade.entry_price)} size={Math.abs(size)} values={trade.stops ?? []} startOpen={false} onOpened={noop} onChange={(v) => save({ stops: v })} />
          </div>
        </div>
        <RiskReward trade={trade} />
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

function Strategy({ trade, allSetups, allMistakes, save, strategies, categories }: { trade: Trade; allSetups: string[]; allMistakes: string[]; save: Save; strategies: StrategyDef[]; categories: TagCategory[] }) {
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
      <Section title="Strategy">
        <StrategyPicker trade={trade} strategies={strategies} save={save} />
      </Section>
      <Section title="Setups">
        <ChipEditor kind="setup" values={trade.tags ?? []} suggestions={allSetups} onChange={(tags) => save({ tags })} />
      </Section>
      <Section title="Mistakes">
        <ChipEditor kind="mistake" values={trade.mistakes ?? []} suggestions={allMistakes} onChange={(mistakes) => save({ mistakes })} />
      </Section>
      <Section title="Custom tags">
        <CustomTags trade={trade} categories={categories} save={save} />
      </Section>
    </>
  )
}

/** Choose the strategy this trade followed; its rules show as a checklist for review (not saved). */
function StrategyPicker({ trade, strategies, save }: { trade: Trade; strategies: StrategyDef[]; save: Save }) {
  const current = strategies.find((s) => s.id === trade.strategy_id)
  if (!strategies.length) return <p className="muted" style={{ margin: 0 }}>No strategies yet. Create one in Settings → My Strategies.</p>
  return (
    <>
      <select className="range-select" value={trade.strategy_id ?? ''} onChange={(e) => save({ strategy_id: e.target.value || null })} aria-label="Strategy">
        <option value="">No strategy</option>
        {strategies.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      {current?.description && <p className="muted" style={{ margin: '8px 0 0', fontSize: 13 }}>{current.description}</p>}
      {current && current.rules.length > 0 && (
        <ul className="td-rules">
          {current.rules.map((r, i) => <li key={`${trade.id}-${i}`}><label><input type="checkbox" />{r}</label></li>)}
        </ul>
      )}
    </>
  )
}

/** One row of toggle chips per custom tag category. */
function CustomTags({ trade, categories, save }: { trade: Trade; categories: TagCategory[]; save: Save }) {
  const values = trade.custom_tags ?? []
  if (!categories.length) return <p className="muted" style={{ margin: 0 }}>No custom tags yet. Create categories in Settings → Custom Tags.</p>
  const toggle = (v: string) => save({ custom_tags: values.includes(v) ? values.filter((x) => x !== v) : [...values, v] })
  return (
    <>
      {categories.map((c) => (
        <div key={c.id} className="ctag-group">
          <span className="label"><span className="dot" style={{ background: c.color }} />{c.name}</span>
          <div className="chips">
            {c.tags.length === 0 && <span className="muted" style={{ fontSize: 12 }}>No tags in this category yet.</span>}
            {c.tags.map((t) => {
              const v = customTag(c.name, t)
              const on = values.includes(v)
              return (
                <button key={t} type="button" className="chip toggle" aria-pressed={on} onClick={() => toggle(v)}
                  style={on ? { borderColor: c.color, color: c.color, background: `${c.color}22` } : undefined}>
                  {t}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </>
  )
}

/** Chips with × to remove and an inline "+ Add" box with suggestions from other trades. */
function ChipEditor({ kind, values, suggestions, onChange }: { kind: 'setup' | 'mistake'; values: string[]; suggestions: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const listId = `dl-${kind}`
  const add = () => {
    const typed = text.trim()
    // Reuse an existing name's casing (e.g. "Bounce"); new names stay lowercase as before.
    const v = suggestions.find((s) => s.toLowerCase() === typed.toLowerCase()) ?? typed.toLowerCase()
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

const noop = () => {}

/** Initial risk $, planned R:R (first target vs first stop) and realized R. */
function RiskReward({ trade }: { trade: Trade }) {
  const entry = trade.entry_price == null ? null : Number(trade.entry_price)
  const size = Math.abs(Number(trade.size) || 0)
  const target = trade.targets?.length ? Number(trade.targets[0]) : null
  const stop = trade.stops?.length ? Number(trade.stops[0]) : null
  const riskPer = entry != null && stop != null ? Math.abs(entry - stop) : null
  const rewardPer = entry != null && target != null ? Math.abs(target - entry) : null
  const riskUsd = riskPer != null && size ? riskPer * size : null
  const rr = riskPer && rewardPer != null ? rewardPer / riskPer : null
  const n = netPnl(trade)
  const realized = riskUsd && tradeStatus(trade) !== 'OPEN' ? n / riskUsd : null
  return (
    <div className="td-rr">
      <div><span className="label">Initial risk ($)</span><b>{riskUsd != null ? `$${fmtMoney(riskUsd, false)}` : '—'}</b></div>
      <div><span className="label">Planned R:R</span><b>{rr != null ? `1 : ${rr.toFixed(2)}` : '—'}</b></div>
      <div><span className="label">Realized R</span><b className={realized != null ? pnlClass(realized) : ''}>{realized != null ? `${realized >= 0 ? '+' : ''}${realized.toFixed(2)}R` : '—'}</b></div>
    </div>
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
  // Price chart first (default), screenshots beside it.
  const [view, setView] = useState<'shots' | 'price'>('price')

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
      <div className="seg td-view" role="tablist">
        <button role="tab" aria-selected={view === 'price'} className={view === 'price' ? 'on' : ''} onClick={() => setView('price')}>Price chart</button>
        <button role="tab" aria-selected={view === 'shots'} className={view === 'shots' ? 'on' : ''} onClick={() => setView('shots')}>Screenshots{paths.length ? ` (${paths.length})` : ''}</button>
      </div>
      {view === 'price' ? <PriceChart trade={trade} /> : <>
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
      </>}
      <input ref={file} type="file" accept="image/*" multiple hidden onChange={(e) => { onFiles([...(e.target.files ?? [])]); e.target.value = '' }} />
      {zoom && cur && urls[cur] && <Lightbox src={urls[cur]} onClose={() => setZoom(false)} />}
    </section>
  )
}
