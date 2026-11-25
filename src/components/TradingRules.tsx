import { useEffect, useRef, useState } from 'react'
import type { RuleReview, TickedRule, Trade, TradeInput } from '../lib/types'
import type { Label } from '../lib/settings'
import { RULES_MIGRATION_MSG } from '../lib/settings'
import { checklist, isFollowed, latestChecklist, score, setupLabel } from '../lib/rules'
import { fmtDateTime } from '../lib/format'

interface Props {
  trade: Trade
  setups: string[] // defined setups plus names used on trades
  labels: Label[]
  loaded: boolean // Settings data (setups and their rules) has loaded
  rulesMissing: boolean
  /** Saves without reloading; the component reloads once all its saves are done. */
  persist: (patch: Partial<TradeInput>) => Promise<boolean>
  reload: () => void
}

const MULTI = '\u0000multi'

/**
 * Pick the trade's setup, then tick its Bias and Entry rules. Changes save immediately;
 * local state keeps quick clicks from overwriting each other while saves are in flight.
 * Render with key={trade.id}.
 */
export function TradingRules({ trade, setups, labels, loaded, rulesMissing, persist, reload }: Props) {
  const [tags, setTags] = useState<string[]>(trade.tags ?? [])
  const [review, setReview] = useState<RuleReview | null>(trade.rule_review ?? null)
  const inFlight = useRef(0)
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const server = useRef(trade)

  // Take the saved values when they change on the server (after our reload, or an edit in the
  // trade form) unless our own saves are still running.
  const tagKey = JSON.stringify(trade.tags ?? [])
  const reviewKey = JSON.stringify(trade.rule_review ?? null)
  useEffect(() => { server.current = trade })
  useEffect(() => {
    if (inFlight.current === 0) setTags(JSON.parse(tagKey))
  }, [tagKey])
  useEffect(() => {
    if (inFlight.current === 0) setReview(JSON.parse(reviewKey))
  }, [reviewKey])

  function write(patch: Partial<TradeInput>) {
    inFlight.current++
    queue.current = queue.current
      .then(() => persist(patch))
      .then((ok) => {
        if (!ok) {
          // Undo the optimistic change; the error is shown by the trade page.
          setTags(server.current.tags ?? [])
          setReview(server.current.rule_review ?? null)
        }
        if (--inFlight.current === 0) reload()
      })
  }

  const setup = tags.length === 1 ? tags[0] : null
  const label = setupLabel(labels, setup)
  const saved = review && setup && review.setup === setup ? review : null
  const cl = checklist(saved, label)
  const options = [...new Set([...setups, ...(setup ? [setup] : [])])].sort((a, b) => a.localeCompare(b))

  function pickSetup(value: string) {
    if (value === MULTI || value === (setup ?? '')) return
    const hasWork = saved && (saved.reviewed_at || [...saved.bias, ...saved.entry].some((r) => r.ok))
    if (hasWork && !confirm(`Change the setup? The rule ticks for "${setup}" on this trade will be cleared.`)) return
    const next = value ? [value] : []
    setTags(next)
    setReview(null)
    write({ tags: next, rule_review: null })
  }

  function update(next: RuleReview) {
    setReview(next)
    write({ rule_review: next })
  }

  const toggle = (group: 'bias' | 'entry', id: string) => {
    const flip = (list: TickedRule[]) => list.map((r) => (r.id === id ? { ...r, ok: !r.ok } : r))
    update({ setup: setup!, bias: group === 'bias' ? flip(cl.bias) : cl.bias, entry: group === 'entry' ? flip(cl.entry) : cl.entry, reviewed_at: saved?.reviewed_at ?? null })
  }
  const markReviewed = () => update({ setup: setup!, bias: cl.bias, entry: cl.entry, reviewed_at: new Date().toISOString() })
  const unmark = () => update({ setup: setup!, bias: cl.bias, entry: cl.entry, reviewed_at: null })
  const loadLatest = () => {
    if (!confirm('Load the latest rules from Settings? Ticks on matching rules are kept, and the trade goes back to not reviewed.')) return
    update({ setup: setup!, ...latestChecklist(label, saved), reviewed_at: null })
  }

  const total = cl.bias.length + cl.entry.length
  const followed = isFollowed(cl)

  return (
    <div className="rules">
      <select className="range-select" value={setup ?? (tags.length > 1 ? MULTI : '')} onChange={(e) => pickSetup(e.target.value)} aria-label="Setup">
        {tags.length > 1 && <option value={MULTI} disabled>Multiple: {tags.join(', ')}. Pick one</option>}
        <option value="">No setup</option>
        {options.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>

      {!loaded ? null : rulesMissing ? (
        <p className="muted fs-13 m-0">{RULES_MIGRATION_MSG}</p>
      ) : !setup ? (
        <p className="muted fs-13 m-0">{tags.length > 1 ? 'This trade has several setups. Pick the one it followed to see its rules.' : 'Pick the setup this trade followed to check its rules.'}</p>
      ) : total === 0 ? (
        <p className="muted fs-13 m-0">No rules for “{setup}” yet. Add them in Settings → Setups.</p>
      ) : (
        <>
          <div className="rules-two">
            <RuleChecks title="Bias" list={cl.bias} onToggle={(id) => toggle('bias', id)} />
            <RuleChecks title="Entry" list={cl.entry} onToggle={(id) => toggle('entry', id)} />
          </div>
          {cl.stale && (
            <div className="rules-note">
              <span className="muted fs-12">The rules for “{setup}” changed in Settings after this review.</span>
              <button className="chip-btn" onClick={loadLatest}>Load latest rules</button>
            </div>
          )}
          <div className="rules-foot">
            {cl.reviewed ? (
              <>
                <span className={`tbadge ${followed ? 'pos-soft' : 'neg-soft'}`}>{followed ? 'Followed' : 'Not followed'}</span>
                <span className="muted fs-12">Reviewed {fmtDateTime(saved!.reviewed_at)}</span>
                <span className="spacer" />
                <button className="chip-btn" onClick={unmark}>Unmark reviewed</button>
              </>
            ) : (
              <>
                <span className="muted fs-12">Not reviewed</span>
                <span className="spacer" />
                <button className="primary" onClick={markReviewed}>Mark reviewed</button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function RuleChecks({ title, list, onToggle }: { title: string; list: TickedRule[]; onToggle: (id: string) => void }) {
  const s = score(list)
  return (
    <div>
      <span className="label">{title} <b className="rules-score">{s.done}/{s.total}</b></span>
      {list.length === 0 ? (
        <p className="muted fs-12 m-0">No {title.toLowerCase()} rules.</p>
      ) : (
        <ul className="td-rules">
          {list.map((r) => (
            <li key={r.id}><label><input type="checkbox" checked={r.ok} onChange={() => onToggle(r.id)} />{r.text}</label></li>
          ))}
        </ul>
      )}
    </div>
  )
}
