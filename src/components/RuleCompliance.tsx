import { useMemo } from 'react'
import type { Trade } from '../lib/types'
import { useTradingTools } from '../lib/settings'
import { complianceStats, isFollowed, isReviewed, reviewOf } from '../lib/rules'
import { summarize } from '../lib/stats'
import { tradeStatus, tradeTime } from '../lib/trades'
import { weekStart } from '../lib/dashboard'
import { fmtMoney, fmtPct, pnlClass } from '../lib/format'

const WEEKS = 8

/** Dashboard widget: share of reviewed trades that followed every rule, and what that was worth. */
export function RuleCompliance({ trades }: { trades: Trade[] }) {
  const { labels } = useTradingTools()
  const closed = useMemo(() => trades.filter((t) => tradeStatus(t) !== 'OPEN'), [trades])
  const c = useMemo(() => complianceStats(closed, labels), [closed, labels])
  const weeks = useMemo(() => weeklyCompliance(closed), [closed])

  const n = c.reviewed.length
  if (!n) {
    return (
      <div className="widget-empty">
        No reviewed trades in this period.
        <br />
        Tick a trade&apos;s rules on its Overview tab, then press Mark reviewed.
      </div>
    )
  }

  const rate = c.followed.length / n
  const yes = summarize(c.followed)
  const no = summarize(c.notFollowed)

  return (
    <div className="rc">
      <div className="rc-col">
        <div className="rc-head">
          <b className={`rc-rate ${rate >= 0.8 ? 'win' : rate < 0.5 ? 'loss' : ''}`}>{fmtPct(rate)}</b>
          <span className="muted fs-12">
            of reviewed trades followed every rule
            <br />
            {c.followed.length} of {n} reviewed{c.pending ? ` · ${c.pending} not reviewed yet` : ''}
          </span>
        </div>
        <div className="rc-split">
          <Side title="Followed" s={yes} />
          <Side title="Not followed" s={no} />
        </div>
      </div>

      <div className="rc-col">
        <div>
          <span className="label">Most-missed rules</span>
          {c.missed.length === 0 ? (
            <p className="muted fs-12 m-0">No missed rules. Every reviewed trade ticked them all.</p>
          ) : (
            <ol className="rc-missed">
              {c.missed.slice(0, 3).map((m) => (
                <li key={`${m.setup}-${m.group}-${m.text}`}>
                  <span className="rc-rule">{m.text}<span className="muted fs-12"> · {m.setup}, {m.group}</span></span>
                  <b className="loss" title={`Missed on ${m.missed} of ${m.seen} reviewed trades`}>{fmtPct(m.missed / m.seen)}</b>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div>
          <span className="label">Weekly compliance</span>
          <div className="rc-trend" role="img" aria-label="Share of reviewed trades that followed every rule, by week">
            {weeks.map((w) => (
              <div key={w.label} className="rc-week" title={`Week of ${w.label}: ${w.followed} of ${w.count} followed`}>
                <div className="rc-track"><span style={{ height: `${Math.max(2, w.rate * 100)}%` }} /></div>
                <span className="rc-week-label">{w.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function Side({ title, s }: { title: string; s: ReturnType<typeof summarize> }) {
  return (
    <div className="strategy">
      <div className="name">{title}</div>
      <div className={`big ${pnlClass(s.net)}`}>{s.count ? fmtMoney(s.net) : '—'}</div>
      <div className="muted">{s.count} {s.count === 1 ? 'trade' : 'trades'}{s.count ? ` · ${fmtPct(s.winRate)} win` : ''}</div>
    </div>
  )
}

/** Followed share per week (Monday start) for the last weeks that have reviewed trades. */
function weeklyCompliance(trades: Trade[]) {
  const m = new Map<number, { count: number; followed: number }>()
  for (const t of trades) {
    if (!isReviewed(t)) continue
    const k = weekStart(tradeTime(t)).getTime()
    const w = m.get(k) ?? { count: 0, followed: 0 }
    w.count++
    if (isFollowed(reviewOf(t)!)) w.followed++
    m.set(k, w)
  }
  return [...m.entries()].sort(([a], [b]) => a - b).slice(-WEEKS).map(([k, w]) => ({
    label: new Date(k).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    rate: w.followed / w.count,
    ...w,
  }))
}
