import type { Rule, RuleReview, TickedRule, Trade } from './types'
import type { Label } from './settings'

// Trading rules: a setup's Bias and Entry checklists, ticked per trade after the fact.

/** The trade's setup for the checklist: only when it has exactly one setup tag. */
export function tradeSetup(t: Pick<Trade, 'tags'>): string | null {
  return t.tags?.length === 1 ? t.tags[0] : null
}

/** The saved review, only if it belongs to the trade's current setup. */
export function reviewOf(t: Pick<Trade, 'tags' | 'rule_review'>): RuleReview | null {
  const r = t.rule_review
  const setup = tradeSetup(t)
  return r && setup && r.setup === setup ? r : null
}

export const isReviewed = (t: Pick<Trade, 'tags' | 'rule_review'>) => Boolean(reviewOf(t)?.reviewed_at)

export function setupLabel(labels: Label[], name: string | null) {
  return name ? labels.find((l) => l.kind === 'setup' && l.name === name) : undefined
}

const withTicks = (rules: Rule[], saved: TickedRule[] = []) =>
  rules.map((r) => ({ id: r.id, text: r.text, ok: saved.find((s) => s.id === r.id)?.ok ?? false }))

/** The setup's current rules with ticks carried over (by rule id) from a saved review. */
export function latestChecklist(label: Label | undefined, saved: RuleReview | null) {
  return { bias: withTicks(label?.bias_rules ?? [], saved?.bias), entry: withTicks(label?.entry_rules ?? [], saved?.entry) }
}

const sameRules = (a: Rule[], b: Rule[]) => a.length === b.length && a.every((r, i) => r.id === b[i].id && r.text === b[i].text)

/**
 * What to show for a trade: a reviewed trade shows its saved copy; otherwise the setup's
 * current rules with any draft ticks. `stale` = the saved copy differs from Settings.
 */
export function checklist(saved: RuleReview | null, label: Label | undefined) {
  if (saved?.reviewed_at) {
    const stale = Boolean(label) && !(sameRules(saved.bias, label!.bias_rules ?? []) && sameRules(saved.entry, label!.entry_rules ?? []))
    return { bias: saved.bias, entry: saved.entry, reviewed: true, stale }
  }
  return { ...latestChecklist(label, saved), reviewed: false, stale: false }
}

export const score = (list: TickedRule[]) => ({ done: list.filter((r) => r.ok).length, total: list.length })

/** Followed = every rule ticked (and there was at least one rule). */
export function isFollowed(r: Pick<RuleReview, 'bias' | 'entry'>) {
  const all = [...r.bias, ...r.entry]
  return all.length > 0 && all.every((x) => x.ok)
}

export type RuleStatus =
  | { kind: 'no-setup' }
  | { kind: 'no-rules' }
  | { kind: 'pending' }
  | { kind: 'reviewed'; done: number; total: number; followed: boolean }

/** Review state of a trade for the Trade Log. Several setup tags count as no setup. */
export function ruleStatus(t: Trade, labels: Label[]): RuleStatus {
  const setup = tradeSetup(t)
  if (!setup) return { kind: 'no-setup' }
  const r = reviewOf(t)
  if (r?.reviewed_at) {
    const all = [...r.bias, ...r.entry]
    return { kind: 'reviewed', done: all.filter((x) => x.ok).length, total: all.length, followed: isFollowed(r) }
  }
  const l = setupLabel(labels, setup)
  return (l?.bias_rules?.length ?? 0) + (l?.entry_rules?.length ?? 0) ? { kind: 'pending' } : { kind: 'no-rules' }
}

export function newRuleId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export interface MissedRule { setup: string; group: 'Bias' | 'Entry'; text: string; seen: number; missed: number }

/**
 * Rule compliance over reviewed trades (pass closed trades). Followed = every rule ticked.
 * `missed` lists rules skipped at least once, most often first (by miss rate, then count).
 */
export function complianceStats(trades: Trade[], labels: Label[]) {
  const withSetup = trades.filter((t) => tradeSetup(t))
  const reviewed = withSetup.filter(isReviewed)
  const followed = reviewed.filter((t) => isFollowed(reviewOf(t)!))
  const notFollowed = reviewed.filter((t) => !isFollowed(reviewOf(t)!))

  const rules = new Map<string, MissedRule>()
  for (const t of reviewed) {
    const r = reviewOf(t)!
    const label = setupLabel(labels, r.setup)
    for (const [group, list, current] of [['Bias', r.bias, label?.bias_rules], ['Entry', r.entry, label?.entry_rules]] as const) {
      for (const x of list) {
        const key = `${r.setup}\u0000${x.id}`
        const m = rules.get(key) ?? { setup: r.setup, group, text: current?.find((c) => c.id === x.id)?.text ?? x.text, seen: 0, missed: 0 }
        m.seen++
        if (!x.ok) m.missed++
        rules.set(key, m)
      }
    }
  }
  const missed = [...rules.values()].filter((m) => m.missed > 0)
    .sort((a, b) => b.missed / b.seen - a.missed / a.seen || b.missed - a.missed)

  // Waiting for review: has a setup with rules but not marked reviewed.
  const pending = withSetup.filter((t) => ruleStatus(t, labels).kind === 'pending').length
  return { pending, reviewed, followed, notFollowed, missed }
}
