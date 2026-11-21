import { useEffect, useState } from 'react'
import type { CurvePoint } from '../lib/stats'
import { fmtMoney } from '../lib/format'

const H = 260
const PAD = { l: 64, r: 16, t: 16, b: 28 }

/** A hand-drawn SVG line chart of cumulative P&L. Hover to see each trade. */
export function EquityChart({ points }: { points: CurvePoint[] }) {
  const [hover, setHover] = useState<number | null>(null)
  // Draw at the real pixel width so labels aren't stretched or squashed on narrow screens.
  const [box, setBox] = useState<HTMLDivElement | null>(null)
  const [W, setW] = useState(800)
  useEffect(() => {
    if (!box) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))))
    ro.observe(box)
    return () => ro.disconnect()
  }, [box])

  if (points.length < 2) return <p>Add at least two trades to see your equity curve.</p>

  // Start the line at zero so the first trade's result is visible.
  const values = [0, ...points.map((p) => p.equity)]
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const x = (i: number) => PAD.l + (i / (values.length - 1)) * (W - PAD.l - PAD.r)
  const y = (v: number) => PAD.t + (1 - (v - min) / span) * (H - PAD.t - PAD.b)

  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const area = `${line} L${x(values.length - 1)},${y(Math.max(min, 0))} L${x(0)},${y(Math.max(min, 0))} Z`
  const final = values[values.length - 1]
  const color = final >= 0 ? 'var(--win)' : 'var(--loss)'
  const ticks = [max, (max + min) / 2, min]

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * W
    const i = Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (values.length - 1))
    setHover(i >= 1 && i < values.length ? i : null)
  }

  const hp = hover !== null ? points[hover - 1] : null
  return (
    <div className="chart" ref={setBox} style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="eq-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.25" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((v, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeDasharray="3 4" />
            <text x={PAD.l - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">
              {fmtMoney(v, false)}
            </text>
          </g>
        ))}
        {min < 0 && max > 0 && <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} stroke="var(--muted)" strokeOpacity="0.5" />}
        <path d={area} fill="url(#eq-fill)" />
        <path d={line} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <text x={PAD.l} y={H - 8} fontSize="11" fill="var(--muted)">{points[0].time.toLocaleDateString()}</text>
        <text x={W - PAD.r} y={H - 8} fontSize="11" fill="var(--muted)" textAnchor="end">
          {points[points.length - 1].time.toLocaleDateString()}
        </text>
        {hover !== null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="var(--muted)" strokeOpacity="0.6" />
            <circle cx={x(hover)} cy={y(values[hover])} r="4" fill={color} />
          </>
        )}
      </svg>
      {hp && (
        <div
          className="panel"
          style={{
            position: 'absolute', top: 8, pointerEvents: 'none', padding: '8px 12px', fontSize: 13,
            ...(hover! / values.length > 0.5 ? { left: Math.min(70, W * 0.1) } : { right: 8 }),
          }}
        >
          <div className="muted">{hp.time.toLocaleString()}</div>
          <div>
            {hp.trade.symbol} {hp.trade.side ?? ''}
          </div>
          <div>Equity <strong>{fmtMoney(hp.equity)}</strong></div>
        </div>
      )}
    </div>
  )
}
