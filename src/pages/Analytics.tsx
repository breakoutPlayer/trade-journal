import { useMemo } from 'react'
import type { Trade } from '../lib/types'
import { groupStats } from '../lib/stats'
import { tradeTime } from '../lib/trades'
import { fmtMoney, fmtPct, pnlClass } from '../lib/format'

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

type Rows = ReturnType<typeof groupStats>

function GroupTable({ title, label, rows }: { title: string; label: string; rows: Rows }) {
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.net)))
  return (
    <div className="panel">
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p>Nothing to show yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{label}</th>
                <th className="num">Trades</th>
                <th className="num">Win rate</th>
                <th className="num">Profit factor</th>
                <th className="num">Avg / trade</th>
                <th className="num">Net P&amp;L</th>
                <th className="bar-cell"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td><strong>{r.key}</strong></td>
                  <td className="num">{r.count}</td>
                  <td className="num">{r.count ? fmtPct(r.winRate) : '—'}</td>
                  <td className="num">{!r.count ? '—' : r.profitFactor === Infinity ? '∞' : r.profitFactor.toFixed(2)}</td>
                  <td className={`num ${pnlClass(r.net)}`}>{r.count ? fmtMoney(r.net / r.count) : '—'}</td>
                  <td className={`num ${pnlClass(r.net)}`}>{fmtMoney(r.net)}</td>
                  <td className="bar-cell">
                    <div
                      className="bar"
                      style={{
                        width: `${(Math.abs(r.net) / maxAbs) * 100}%`,
                        background: r.net >= 0 ? 'var(--win)' : 'var(--loss)',
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function Analytics({ trades }: { trades: Trade[] }) {
  const byNet = (a: { net: number }, b: { net: number }) => b.net - a.net

  const pairs = useMemo(() => groupStats(trades, (t) => [t.symbol]).sort(byNet), [trades])

  const days = useMemo(() => {
    const rows = groupStats(trades, (t) => [WEEKDAYS[(tradeTime(t).getDay() + 6) % 7]])
    // Keep calendar order and show days with no trades too.
    return WEEKDAYS.map((d) => rows.find((r) => r.key === d) ?? { ...emptyRow(), key: d })
  }, [trades])

  const tags = useMemo(
    () => groupStats(trades, (t) => (t.tags?.length ? t.tags : ['(untagged)'])).sort(byNet),
    [trades],
  )

  return (
    <>
      <h1>Analytics</h1>
      <p style={{ marginTop: -6 }}>
        Days use your local time and the trade&apos;s close time. A trade with several tags counts toward each tag.
      </p>
      <GroupTable title="By pair" label="Pair" rows={pairs} />
      <GroupTable title="By day of week" label="Day" rows={days} />
      <GroupTable title="By tag" label="Tag" rows={tags} />
    </>
  )
}

function emptyRow(): Rows[number] {
  return {
    key: '', count: 0, wins: 0, losses: 0, net: 0, fees: 0, grossWin: 0, grossLoss: 0,
    winRate: 0, profitFactor: 0, avgWin: 0, avgLoss: 0, best: 0, worst: 0, maxDrawdown: 0,
  }
}
