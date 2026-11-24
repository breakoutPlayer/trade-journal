import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import type { Trade } from '../lib/types'
import { accountOf, addTransfer, deleteTransfer, saveBalance, transferTotals, useAccountBalances } from '../lib/accounts'
import { netPnl } from '../lib/trades'
import {
  COLORS, addCategory, addLabel, changeCategoryTag, customTag, deleteCategory, deleteLabel, deleteStrategy,
  friendlyNameError, saveCategory, saveLabel, saveStrategy, setCategoryTags, useTradingTools,
  type Label, type LabelKind, type Strategy, type TagCategory,
} from '../lib/settings'

type Section = 'accounts' | 'setups' | 'mistakes' | 'tags' | 'strategies'
const SECTIONS: [Section, string][] = [['accounts', 'Accounts'], ['setups', 'Setups'], ['mistakes', 'Mistakes'], ['tags', 'Custom Tags'], ['strategies', 'My Strategies']]

interface Props {
  trades: Trade[]
  reload: () => void // reloads trades after renames/deletes
}

export function Settings({ trades, reload }: Props) {
  const [section, setSection] = useState<Section>('accounts')
  const tools = useTradingTools()
  const refresh = () => { tools.reload(); reload() }

  return (
    <div className="settings">
      <nav className="settings-nav" aria-label="Settings">
        <div className="settings-title">Settings</div>
        <div className="settings-group">Account</div>
        <button className={section === 'accounts' ? 'active' : ''} onClick={() => setSection('accounts')}>Accounts</button>
        <div className="settings-group">Trading tools &amp; strategies</div>
        {SECTIONS.filter(([id]) => id !== 'accounts').map(([id, label]) => (
          <button key={id} className={section === id ? 'active' : ''} onClick={() => setSection(id)}>{label}</button>
        ))}
      </nav>
      <div className="settings-body">
        <div className="settings-crumb">{section === 'accounts' ? 'Account' : 'Trading tools & strategies'}</div>
        <h1>{SECTIONS.find(([id]) => id === section)![1]}</h1>
        {tools.error && <div className="panel error">{tools.error}</div>}
        {section === 'accounts' && <Accounts trades={trades} />}
        {section === 'setups' && <LabelList kind="setup" labels={tools.labels} trades={trades} refresh={refresh} />}
        {section === 'mistakes' && <LabelList kind="mistake" labels={tools.labels} trades={trades} refresh={refresh} />}
        {section === 'tags' && <Categories categories={tools.categories} trades={trades} refresh={refresh} />}
        {section === 'strategies' && <Strategies strategies={tools.strategies} trades={trades} refresh={refresh} />}
      </div>
    </div>
  )
}

// ---------- shared bits ----------

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="swatches" role="radiogroup" aria-label="Color">
      {COLORS.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={c === value} aria-label={c} className={c === value ? 'on' : ''} style={{ background: c }} onClick={() => onChange(c)} />
      ))}
    </div>
  )
}

const Dot = ({ color }: { color: string }) => <span className="dot" style={{ background: color }} />

/** Runs an async action, showing errors inline. */
function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await fn(); return true } catch (e) { setError(friendlyNameError(e)); return false } finally { setBusy(false) }
  }
  return { busy, error, run }
}

function NameForm({ initial, initialColor, placeholder, onSave, onCancel, busy }: {
  initial: string; initialColor: string; placeholder: string; busy: boolean
  onSave: (name: string, color: string) => void; onCancel: () => void
}) {
  const [name, setName] = useState(initial)
  const [color, setColor] = useState(initialColor)
  const submit = (e: FormEvent) => { e.preventDefault(); if (name.trim()) onSave(name, color) }
  return (
    <form className="set-form" onSubmit={submit}>
      <input autoFocus value={name} maxLength={60} placeholder={placeholder} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && onCancel()} />
      <ColorPicker value={color} onChange={setColor} />
      <span className="spacer" />
      <button type="button" className="chip-btn" onClick={onCancel}>Cancel</button>
      <button className="primary" disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Save'}</button>
    </form>
  )
}

function Header({ children, onAdd, adding }: { children?: ReactNode; onAdd: () => void; adding: boolean }) {
  return (
    <div className="set-head">
      {children}
      <span className="spacer" />
      <button className="chip-btn" disabled={adding} onClick={onAdd}>Add new +</button>
    </div>
  )
}

// ---------- accounts ----------

function Accounts({ trades }: { trades: Trade[] }) {
  const { balances, transfers, error, reload } = useAccountBalances()
  const moved = useMemo(() => transferTotals(transfers), [transfers])
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [text, setText] = useState('')
  const act = useAction()
  const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const rows = useMemo(() => {
    const m = new Map<string, { count: number; net: number }>()
    for (const t of trades) {
      const k = accountOf(t)
      const cur = m.get(k) ?? { count: 0, net: 0 }
      cur.count++; cur.net += netPnl(t)
      m.set(k, cur)
    }
    for (const k of [...Object.keys(balances), ...Object.keys(moved)]) if (!m.has(k)) m.set(k, { count: 0, net: 0 })
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [trades, balances, moved])

  const start = (key: string) => { setEditing(key); setText(balances[key] ? String(balances[key]) : '') }
  const save = async (e: FormEvent, key: string) => {
    e.preventDefault()
    const v = text.trim() === '' ? null : Number(text.replace(/[$,\s]/g, ''))
    if (v != null && !(v > 0)) return act.run(async () => { throw new Error('Enter a balance above 0, or leave it empty to clear it.') })
    if (await act.run(() => saveBalance(key, v))) { setEditing(null); reload() }
  }

  return (
    <>
      <p className="muted set-intro">
        Set the starting balance of each account (what it held before the trades in your journal). It is used to show
        drawdowns as a % of your balance and the account's current balance. Record deposits and withdrawals so the
        balance stays right; they don't count as trading profit.
      </p>
      {(error || act.error) && <div className="panel error">{error || act.error}</div>}
      <div className="set-table">
        <div className="set-row set-th acct-row"><span>Account</span><span className="num">Starting balance</span><span className="num">Deposits</span><span className="num">Net P&amp;L</span><span className="num">Current</span><span /></div>
        {rows.length === 0 && <p className="set-empty">No accounts yet. They appear once you have trades.</p>}
        {rows.map(([key, r]) => {
          const bal = balances[key]
          return editing === key ? (
            <form key={key} className="set-form" onSubmit={(e) => save(e, key)}>
              <span className="set-name grow">{key}</span>
              <input autoFocus inputMode="decimal" placeholder="e.g. 1000" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setEditing(null)} style={{ flex: '0 1 160px' }} aria-label={`Starting balance for ${key}`} />
              <button type="button" className="chip-btn" onClick={() => setEditing(null)}>Cancel</button>
              <button className="primary" disabled={act.busy}>{act.busy ? 'Saving…' : 'Save'}</button>
            </form>
          ) : (
            <div key={key} className="set-row acct-row">
              <span className="set-name">{key}<span className="muted set-hint">{r.count} {r.count === 1 ? 'trade' : 'trades'}</span></span>
              <span className="num">{bal ? money(bal) : <span className="muted">Not set</span>}</span>
              <span className="num">{moved[key] ? money(moved[key]) : <span className="muted">—</span>}</span>
              <span className={`num ${r.net > 0 ? 'win' : r.net < 0 ? 'loss' : ''}`}>{money(r.net)}</span>
              <span className="num">{bal || moved[key] ? money((bal ?? 0) + (moved[key] ?? 0) + r.net) : '—'}</span>
              <span className="set-actions">
                <button className="link-muted" onClick={() => start(key)} aria-label={`Set balance for ${key}`} title="Set balance">✎</button>
                {bal && <button className="link-muted" onClick={async () => { if (confirm(`Clear the starting balance of ${key}?`) && await act.run(() => saveBalance(key, null))) reload() }} aria-label={`Clear balance for ${key}`} title="Clear">🗑</button>}
              </span>
            </div>
          )
        })}
      </div>

      <div className="set-head mt-16">
        <h2 className="m-0 fs-16">Deposits &amp; withdrawals</h2>
        <span className="spacer" />
        <button className="chip-btn" disabled={adding || rows.length === 0} onClick={() => setAdding(true)}>+ Deposit / withdrawal</button>
      </div>
      {adding && (
        <TransferForm accounts={rows.map(([k]) => k)} busy={act.busy} onCancel={() => setAdding(false)}
          onSave={async (key, amount, at, note) => { if (await act.run(() => addTransfer(key, amount, at, note))) { setAdding(false); reload() } }} />
      )}
      <div className="set-table">
        {transfers.length === 0 && !adding && <p className="set-empty">No deposits or withdrawals yet.</p>}
        {transfers.map((t) => (
          <div key={t.id} className="set-row xfer-row">
            <span>{new Date(t.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            <span className="set-name">{t.account_key}{t.note && <span className="muted set-hint">{t.note}</span>}</span>
            <span className={`num ${t.amount > 0 ? 'win' : 'loss'}`}>{t.amount > 0 ? '+' : ''}{money(t.amount)}</span>
            <span className="set-actions">
              <button className="link-muted" title="Delete" aria-label={`Delete ${t.amount > 0 ? 'deposit' : 'withdrawal'} of ${money(Math.abs(t.amount))}`}
                onClick={async () => { if (confirm(`Delete this ${t.amount > 0 ? 'deposit' : 'withdrawal'} of ${money(Math.abs(t.amount))}?`) && await act.run(() => deleteTransfer(t.id))) reload() }}>🗑</button>
            </span>
          </div>
        ))}
      </div>
    </>
  )
}

function TransferForm({ accounts, busy, onSave, onCancel }: {
  accounts: string[]; busy: boolean
  onSave: (account: string, amount: number, at: Date, note: string) => void; onCancel: () => void
}) {
  const today = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const [account, setAccount] = useState(accounts[0] ?? '')
  const [kind, setKind] = useState<'deposit' | 'withdrawal'>('deposit')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(`${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`)
  const [note, setNote] = useState('')
  const value = Number(amount.replace(/[$,\s]/g, ''))
  const ok = account && value > 0 && date
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!ok) return
    const [y, m, d] = date.split('-').map(Number)
    // Noon local time, so the deposit lands on the chosen day in any time zone view.
    onSave(account, kind === 'deposit' ? value : -value, new Date(y, m - 1, d, 12), note)
  }
  return (
    <form className="set-table set-card set-strategy xfer-form" onSubmit={submit}>
      <div className="seg" role="radiogroup" aria-label="Type">
        <button type="button" role="radio" aria-checked={kind === 'deposit'} className={kind === 'deposit' ? 'on' : ''} onClick={() => setKind('deposit')}>Deposit</button>
        <button type="button" role="radio" aria-checked={kind === 'withdrawal'} className={kind === 'withdrawal' ? 'on' : ''} onClick={() => setKind('withdrawal')}>Withdrawal</button>
      </div>
      <div className="xfer-grid">
        <label>Account
          <select value={account} onChange={(e) => setAccount(e.target.value)}>{accounts.map((a) => <option key={a} value={a}>{a}</option>)}</select>
        </label>
        <label>Amount ($)<input autoFocus inputMode="decimal" placeholder="e.g. 500" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label>Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label>Note (optional)<input maxLength={200} placeholder="e.g. Monthly top-up" value={note} onChange={(e) => setNote(e.target.value)} /></label>
      </div>
      <div className="row">
        <span className="spacer" />
        <button type="button" className="chip-btn" onClick={onCancel}>Cancel</button>
        <button className="primary" disabled={busy || !ok}>{busy ? 'Saving…' : kind === 'deposit' ? 'Add deposit' : 'Add withdrawal'}</button>
      </div>
    </form>
  )
}

// ---------- setups & mistakes ----------

function LabelList({ kind, labels, trades, refresh }: { kind: LabelKind; labels: Label[]; trades: Trade[]; refresh: () => void }) {
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const act = useAction()
  const word = kind === 'setup' ? 'setup' : 'mistake'

  // Defined labels plus names already used on trades (so nothing is hidden), with trade counts.
  const rows = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of trades) for (const v of (kind === 'setup' ? t.tags : t.mistakes) ?? []) counts.set(v, (counts.get(v) ?? 0) + 1)
    const defined = labels.filter((l) => l.kind === kind)
    const names = new Set([...defined.map((l) => l.name), ...counts.keys()])
    return [...names].sort((a, b) => a.localeCompare(b)).map((name) => {
      const l = defined.find((x) => x.name === name)
      return { name, id: l?.id, color: l?.color ?? '#94a3b8', count: counts.get(name) ?? 0 }
    })
  }, [labels, trades, kind])

  const remove = async (r: (typeof rows)[number]) => {
    const msg = r.count ? `Delete "${r.name}"? It will be removed from ${r.count} trade(s).` : `Delete "${r.name}"?`
    if (!confirm(msg)) return
    if (await act.run(() => deleteLabel(kind, r.name, r.id))) refresh()
  }

  return (
    <>
      <Header onAdd={() => { setAdding(true); setEditing(null) }} adding={adding} />
      {act.error && <div className="panel error">{act.error}</div>}
      <div className="set-table">
        <div className="set-row set-th"><span>Name</span><span className="num">Trades</span><span /></div>
        {adding && (
          <NameForm initial="" initialColor={kind === 'setup' ? COLORS[0] : COLORS[3]} placeholder={`New ${word} name`} busy={act.busy}
            onCancel={() => setAdding(false)}
            onSave={async (name, color) => { if (await act.run(() => addLabel(kind, name, color))) { setAdding(false); refresh() } }} />
        )}
        {rows.length === 0 && !adding && <p className="set-empty">No {word}s yet. Click “Add new” to create one.</p>}
        {rows.map((r) => editing === r.name ? (
          <NameForm key={r.name} initial={r.name} initialColor={r.color} placeholder="Name" busy={act.busy}
            onCancel={() => setEditing(null)}
            onSave={async (name, color) => {
              if (name.trim() !== r.name && r.count && !confirm(`Rename "${r.name}" to "${name.trim()}" on ${r.count} trade(s)?`)) return
              if (await act.run(() => saveLabel(kind, r.name, name, color, r.id))) { setEditing(null); refresh() }
            }} />
        ) : (
          <div key={r.name} className="set-row">
            <span className="set-name"><Dot color={r.color} />{r.name}{!r.id && <span className="muted set-hint">used on trades</span>}</span>
            <span className="num">{r.count}</span>
            <span className="set-actions">
              <button className="link-muted" onClick={() => { setEditing(r.name); setAdding(false) }} aria-label={`Edit ${r.name}`} title="Edit">✎</button>
              <button className="link-muted" onClick={() => remove(r)} aria-label={`Delete ${r.name}`} title="Delete">🗑</button>
            </span>
          </div>
        ))}
      </div>
    </>
  )
}

// ---------- custom tags ----------

function Categories({ categories, trades, refresh }: { categories: TagCategory[]; trades: Trade[]; refresh: () => void }) {
  const [asc, setAsc] = useState(true)
  const [adding, setAdding] = useState(false)
  const act = useAction()
  const sorted = [...categories].sort((a, b) => (asc ? 1 : -1) * a.name.localeCompare(b.name))

  return (
    <>
      <p className="muted set-intro">
        Create custom categories to track as tags. They work like setups and mistakes, and appear on the trade
        detail (Strategy tab) where you can tag your trades with them.
      </p>
      <Header onAdd={() => setAdding(true)} adding={adding}>
        <span className="muted">Sort</span>
        <div className="seg">
          <button className={asc ? 'on' : ''} onClick={() => setAsc(true)}>A-Z</button>
          <button className={!asc ? 'on' : ''} onClick={() => setAsc(false)}>Z-A</button>
        </div>
      </Header>
      {act.error && <div className="panel error">{act.error}</div>}
      {adding && (
        <div className="set-table">
          <NameForm initial="" initialColor={COLORS[1]} placeholder="Category name, e.g. Timeframe" busy={act.busy}
            onCancel={() => setAdding(false)}
            onSave={async (name, color) => { if (await act.run(() => addCategory(name, color))) { setAdding(false); refresh() } }} />
        </div>
      )}
      {sorted.length === 0 && !adding && <div className="set-table"><p className="set-empty">No custom tags yet. Click “Add new” to create a category.</p></div>}
      {sorted.map((c) => <CategoryCard key={c.id} cat={c} trades={trades} refresh={refresh} />)}
    </>
  )
}

function CategoryCard({ cat, trades, refresh }: { cat: TagCategory; trades: Trade[]; refresh: () => void }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const act = useAction()
  const count = (tag?: string) => trades.filter((t) => (t.custom_tags ?? []).some((v) => (tag ? v === customTag(cat.name, tag) : v.startsWith(cat.name + ': ')))).length

  const addTag = async (e: FormEvent) => {
    e.preventDefault()
    const v = text.trim()
    if (!v || cat.tags.includes(v)) return setText('')
    if (await act.run(() => setCategoryTags(cat, [...cat.tags, v]))) { setText(''); refresh() }
  }
  const removeTag = async (tag: string) => {
    const n = count(tag)
    if (n && !confirm(`Remove "${tag}"? It will be removed from ${n} trade(s).`)) return
    if (await act.run(() => changeCategoryTag(cat, tag, null))) refresh()
  }
  const remove = async () => {
    const n = count()
    if (!confirm(`Delete category "${cat.name}"${n ? ` and remove its tags from ${n} trade(s)` : ''}?`)) return
    if (await act.run(() => deleteCategory(cat))) refresh()
  }

  return (
    <div className="set-table set-card">
      {editing ? (
        <NameForm initial={cat.name} initialColor={cat.color} placeholder="Category name" busy={act.busy}
          onCancel={() => setEditing(false)}
          onSave={async (name, color) => { if (await act.run(() => saveCategory(cat, name, color))) { setEditing(false); refresh() } }} />
      ) : (
        <div className="set-row">
          <span className="set-name"><Dot color={cat.color} /><b>{cat.name}</b></span>
          <span className="num muted">{count()} trades</span>
          <span className="set-actions">
            <button className="link-muted" onClick={() => setEditing(true)} aria-label={`Edit ${cat.name}`} title="Edit">✎</button>
            <button className="link-muted" onClick={remove} aria-label={`Delete ${cat.name}`} title="Delete">🗑</button>
          </span>
        </div>
      )}
      {act.error && <p className="error mx-12">{act.error}</p>}
      <div className="chips set-tags">
        {cat.tags.map((t) => (
          <span key={t} className="chip ctag" style={{ borderColor: cat.color, color: cat.color }}>
            {t} <span className="muted">{count(t) || ''}</span>
            <button aria-label={`Remove ${t}`} onClick={() => removeTag(t)}>×</button>
          </span>
        ))}
        <form className="chip-add" onSubmit={addTag}>
          <input value={text} maxLength={40} placeholder="+ Add tag" onChange={(e) => setText(e.target.value)} />
        </form>
      </div>
    </div>
  )
}

// ---------- strategies ----------

type Draft = Omit<Strategy, 'id'> & { id?: string }
const blank: Draft = { name: '', description: '', rules: [], color: COLORS[2] }

function Strategies({ strategies, trades, refresh }: { strategies: Strategy[]; trades: Trade[]; refresh: () => void }) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const act = useAction()
  const count = (id: string) => trades.filter((t) => t.strategy_id === id).length

  const remove = async (s: Strategy) => {
    const n = count(s.id)
    if (!confirm(`Delete strategy "${s.name}"?${n ? ` ${n} trade(s) will no longer be linked to it.` : ''}`)) return
    if (await act.run(() => deleteStrategy(s.id))) refresh()
  }

  return (
    <>
      <Header onAdd={() => setDraft({ ...blank })} adding={!!draft && !draft.id} />
      {act.error && <div className="panel error">{act.error}</div>}
      {draft && !draft.id && <StrategyForm draft={draft} busy={act.busy} onCancel={() => setDraft(null)} onSave={async (d) => { if (await act.run(() => saveStrategy(d))) { setDraft(null); refresh() } }} />}
      {strategies.length === 0 && !draft && <div className="set-table"><p className="set-empty">No strategies yet. Click “Add new” to create one.</p></div>}
      {strategies.map((s) => draft?.id === s.id ? (
        <StrategyForm key={s.id} draft={draft} busy={act.busy} onCancel={() => setDraft(null)} onSave={async (d) => { if (await act.run(() => saveStrategy(d))) { setDraft(null); refresh() } }} />
      ) : (
        <div key={s.id} className="set-table set-card">
          <div className="set-row">
            <span className="set-name"><Dot color={s.color} /><b>{s.name}</b></span>
            <span className="num muted">{count(s.id)} trades</span>
            <span className="set-actions">
              <button className="link-muted" onClick={() => setDraft({ ...s })} aria-label={`Edit ${s.name}`} title="Edit">✎</button>
              <button className="link-muted" onClick={() => remove(s)} aria-label={`Delete ${s.name}`} title="Delete">🗑</button>
            </span>
          </div>
          {s.description && <p className="set-desc">{s.description}</p>}
          {s.rules.length > 0 && <ol className="set-rules">{s.rules.map((r, i) => <li key={i}>{r}</li>)}</ol>}
        </div>
      ))}
    </>
  )
}

function StrategyForm({ draft, busy, onSave, onCancel }: { draft: Draft; busy: boolean; onSave: (d: Draft) => void; onCancel: () => void }) {
  const [d, setD] = useState(draft)
  const [rules, setRules] = useState(draft.rules.join('\n'))
  return (
    <form className="set-table set-card set-strategy" onSubmit={(e) => { e.preventDefault(); if (d.name.trim()) onSave({ ...d, rules: rules.split('\n') }) }}>
      <label>Name<input autoFocus value={d.name} maxLength={60} placeholder="e.g. 15m trend pullback" onChange={(e) => setD({ ...d, name: e.target.value })} /></label>
      <label>Color<ColorPicker value={d.color} onChange={(color) => setD({ ...d, color })} /></label>
      <label>Description<textarea rows={2} value={d.description ?? ''} placeholder="When and why you take this trade" onChange={(e) => setD({ ...d, description: e.target.value })} /></label>
      <label>Rules (one per line)<textarea rows={5} value={rules} placeholder={'15m downtrend\nEntry at 0.382\nTP at 1.236\nSL above swing high'} onChange={(e) => setRules(e.target.value)} /></label>
      <div className="row">
        <span className="spacer" />
        <button type="button" className="chip-btn" onClick={onCancel}>Cancel</button>
        <button className="primary" disabled={busy || !d.name.trim()}>{busy ? 'Saving…' : 'Save strategy'}</button>
      </div>
    </form>
  )
}
