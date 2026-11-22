import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import type { Trade, TradeInput } from '../lib/types'
import { deleteTrade, friendlySaveError, netPnl, tradeReturn, tradeStatus, updateTrade } from '../lib/trades'
import { checkChartFile, removeCharts, uploadChart, useChartUrls } from '../lib/charts'
import { fmtDateTime, fmtMoney, fmtNum, pnlClass } from '../lib/format'
import { Lightbox } from '../components/Charts'

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

// ---------- Notes ----------

const TEMPLATE_KEY = 'tidemark.noteTemplates'
interface Template { name: string; body: string }
function loadTemplates(): Template[] {
  try {
    return JSON.parse(localStorage.getItem(TEMPLATE_KEY) || '[]')
  } catch {
    return []
  }
}
function storeTemplates(list: Template[]) {
  try {
    localStorage.setItem(TEMPLATE_KEY, JSON.stringify(list))
  } catch {
    /* storage unavailable: templates just won't persist */
  }
}

const PLACEHOLDER = 'Why did you take this trade?\nDid you follow your rules?\nNote any emotions, chart patterns or trade management lessons learned.'

function Notes({ trade, save, onImages, uploading }: { trade: Trade; save: Save; onImages: (f: File[]) => void; uploading: boolean }) {
  const [text, setText] = useState(trade.notes ?? '')
  const [status, setStatus] = useState<'' | 'saving' | 'saved'>('')
  const [preview, setPreview] = useState(false)
  const [templates, setTemplates] = useState(loadTemplates)
  const [menu, setMenu] = useState(false)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const ta = useRef<HTMLTextAreaElement>(null)
  const file = useRef<HTMLInputElement>(null)
  const dirty = text !== (trade.notes ?? '')

  async function commit() {
    if (!dirty) return
    setStatus('saving')
    const ok = await save({ notes: text.trim() ? text : null })
    setStatus(ok ? 'saved' : '')
  }

  // Insert through execCommand so the browser's undo/redo history keeps working.
  function insert(s: number, e: number, str: string, selectInner?: [number, number]) {
    const el = ta.current
    if (!el) return
    el.focus()
    el.setSelectionRange(s, e)
    if (!document.execCommand('insertText', false, str)) {
      const v = el.value.slice(0, s) + str + el.value.slice(e)
      setText(v)
    } else setText(el.value)
    if (selectInner) requestAnimationFrame(() => el.setSelectionRange(s + selectInner[0], s + selectInner[1]))
  }
  function wrap(mark: string) {
    const el = ta.current
    if (!el) return
    const { selectionStart: s, selectionEnd: e, value } = el
    const sel = value.slice(s, e) || 'text'
    insert(s, e, mark + sel + mark, [mark.length, mark.length + sel.length])
  }
  function list(ordered: boolean) {
    const el = ta.current
    if (!el) return
    const { value } = el
    const s = value.lastIndexOf('\n', el.selectionStart - 1) + 1
    let e = value.indexOf('\n', el.selectionEnd)
    if (e < 0) e = value.length
    const lines = value.slice(s, e).split('\n')
    const already = lines.every((l) => (ordered ? /^\d+\. / : /^- /).test(l))
    const out = lines.map((l, i) => (already ? l.replace(ordered ? /^\d+\. / : /^- /, '') : `${ordered ? `${i + 1}. ` : '- '}${l}`)).join('\n')
    insert(s, e, out)
  }
  function history(cmd: 'undo' | 'redo') {
    ta.current?.focus()
    document.execCommand(cmd)
    if (ta.current) setText(ta.current.value)
  }
  function applyTemplate(t: Template) {
    setMenu(false)
    setPreview(false)
    requestAnimationFrame(() => {
      const el = ta.current
      if (!el) return
      const pre = el.value && !el.value.endsWith('\n') ? '\n' : ''
      insert(el.value.length, el.value.length, pre + t.body)
    })
  }
  function saveTemplate() {
    const n = name.trim()
    if (!n || !text.trim()) return setNaming(false)
    const next = [...templates.filter((t) => t.name !== n), { name: n, body: text }]
    setTemplates(next)
    storeTemplates(next)
    setNaming(false)
    setName('')
  }
  function deleteTemplate(n: string) {
    const next = templates.filter((t) => t.name !== n)
    setTemplates(next)
    storeTemplates(next)
  }

  return (
    <>
      <Section title="Trade notes">
        <div className="nt-bar" onMouseDown={(e) => (e.target as HTMLElement).closest('button') && e.preventDefault()}>
          <button className={preview ? 'active' : ''} title="Preview formatting" onClick={() => setPreview(!preview)}>Aa</button>
          <button title="Bold" disabled={preview} onClick={() => wrap('**')}><b>B</b></button>
          <button title="Italic" disabled={preview} onClick={() => wrap('_')}><i>I</i></button>
          <button title="Strikethrough" disabled={preview} onClick={() => wrap('~~')}><s>S</s></button>
          <button title="Bulleted list" aria-label="Bulleted list" disabled={preview} onClick={() => list(false)}><Icon d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" /></button>
          <button title="Numbered list" aria-label="Numbered list" disabled={preview} onClick={() => list(true)}><Icon d="M10 6h10M10 12h10M10 18h10M4 4v4M3 14h3l-3 4h3" /></button>
          <span className="spacer" />
          <button title="Undo" aria-label="Undo" disabled={preview} onClick={() => history('undo')}><Icon d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" /></button>
          <button title="Redo" aria-label="Redo" disabled={preview} onClick={() => history('redo')}><Icon d="m15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3" /></button>
          <span className="nt-sep" />
          <div className="nt-menu-wrap">
            <button title="Insert template" onClick={() => setMenu(!menu)}>+</button>
            {menu && (
              <div className="nt-menu">
                {templates.length === 0 && <div className="muted nt-empty">No templates yet. Write a note and use "Save as new template".</div>}
                {templates.map((t) => (
                  <div key={t.name} className="nt-item">
                    <button onClick={() => applyTemplate(t)}>{t.name}</button>
                    <button aria-label={`Delete template ${t.name}`} onClick={() => deleteTemplate(t.name)}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        {preview ? (
          <div className="nt-preview">{text.trim() ? <Markdown text={text} /> : <span className="muted">Nothing written yet.</span>}</div>
        ) : (
          <textarea ref={ta} className="nt-text" value={text} placeholder={PLACEHOLDER} onChange={(e) => { setText(e.target.value); setStatus('') }} onBlur={commit} />
        )}
        <div className="nt-foot">
          {naming ? (
            <form className="chip-add" onSubmit={(e) => { e.preventDefault(); saveTemplate() }}>
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Template name" onKeyDown={(e) => e.key === 'Escape' && setNaming(false)} />
              <button className="chip-btn">Save</button>
            </form>
          ) : (
            <button className="link-muted" disabled={!text.trim()} onClick={() => setNaming(true)}>⧉ Save as new template</button>
          )}
          <span className="spacer" />
          <span className="muted nt-status">{status === 'saving' ? 'Saving…' : status === 'saved' && !dirty ? 'Saved' : dirty ? 'Unsaved' : ''}</span>
          <button className="chip-btn" disabled={!dirty || status === 'saving'} onClick={commit}>Save</button>
        </div>
      </Section>
      <button className="td-dashed" disabled={uploading} onClick={() => file.current?.click()}>{uploading ? 'Uploading…' : 'Add image +'}</button>
      <input ref={file} type="file" accept="image/*" multiple hidden onChange={(e) => { onImages([...(e.target.files ?? [])]); e.target.value = '' }} />
    </>
  )
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ display: 'block', margin: '0 auto' }}>
      <path d={d} />
    </svg>
  )
}

/** Minimal, safe Markdown: **bold**, _italic_, ~~strike~~, "- " and "1. " lists. Rendered as React nodes, never raw HTML. */
function Markdown({ text }: { text: string }) {
  const inline = (s: string) =>
    s.split(/(\*\*[^*]+\*\*|~~[^~]+~~|_[^_]+_)/g).map((part, i) =>
      part.startsWith('**') && part.endsWith('**') && part.length > 4 ? <b key={i}>{part.slice(2, -2)}</b>
      : part.startsWith('~~') && part.endsWith('~~') && part.length > 4 ? <s key={i}>{part.slice(2, -2)}</s>
      : part.startsWith('_') && part.endsWith('_') && part.length > 2 ? <i key={i}>{part.slice(1, -1)}</i>
      : part,
    )
  const blocks: ReactNode[] = []
  let items: string[] = []
  let ordered = false
  const flush = () => {
    if (!items.length) return
    const lis = items.map((t, i) => <li key={i}>{inline(t)}</li>)
    blocks.push(ordered ? <ol key={blocks.length}>{lis}</ol> : <ul key={blocks.length}>{lis}</ul>)
    items = []
  }
  for (const line of text.split('\n')) {
    const ul = /^- (.*)/.exec(line)
    const ol = /^\d+\. (.*)/.exec(line)
    if (ul || ol) {
      if (items.length && ordered !== Boolean(ol)) flush()
      ordered = Boolean(ol)
      items.push((ul ?? ol)![1])
    } else {
      flush()
      blocks.push(line.trim() ? <p key={blocks.length}>{inline(line)}</p> : <br key={blocks.length} />)
    }
  }
  flush()
  return <>{blocks}</>
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
