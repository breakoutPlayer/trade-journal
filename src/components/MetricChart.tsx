import { useEffect, useState } from 'react'
import type { SeriesPoint } from '../lib/reports'

const H = 320
const PAD = { l: 8, r: 64, t: 16, b: 28 }

/** Line or bar chart of one metric over time, with a right-hand value axis and hover read-out. */
export function MetricChart({ points, mode, fmt }: { points: SeriesPoint[]; mode: 'line' | 'bar'; fmt: (v: number | null) => string }) {
  const [hover, setHover] = useState<number | null>(null)
  const [box, setBox] = useState<HTMLDivElement | null>(null)
  const [W, setW] = useState(800)
  useEffect(() => {
    if (!box) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))))
    ro.observe(box)
    return () => ro.disconnect()
  }, [box])

  const data = points.map((p) => ({ ...p, v: p.value != null && Number.isFinite(p.value) ? p.value : 0 }))
  if (!data.length) return <div className="widget-empty">No data</div>

  const vals = data.map((d) => d.v)
  let min = Math.min(0, ...vals)
  let max = Math.max(0, ...vals)
  if (max === min) max = min + 1
  const span = max - min
  const n = data.length
  const plotW = W - PAD.l - PAD.r
  const x = (i: number) => PAD.l + (n === 1 ? 0 : (i / (n - 1)) * plotW)
  const slot = plotW / n
  const bx = (i: number) => PAD.l + slot * i + slot / 2
  const y = (v: number) => PAD.t + (1 - (v - min) / span) * (H - PAD.t - PAD.b)
  const ticks = Array.from({ length: 5 }, (_, i) => min + (span * i) / 4)
  const line = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.v).toFixed(1)}`).join(' ')

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * W
    const i = mode === 'bar' ? Math.floor((px - PAD.l) / slot) : Math.round(((px - PAD.l) / plotW) * (n - 1))
    setHover(i >= 0 && i < n ? i : null)
  }
  const hp = hover != null ? data[hover] : null

  return (
    <div className="chart" ref={setBox} style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height: H }} onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)}>
        {ticks.map((v, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeDasharray="3 4" />
            <text x={W - PAD.r + 8} y={y(v) + 4} fontSize="11" fill="var(--muted)">{fmt(v)}</text>
          </g>
        ))}
        <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} stroke="var(--accent)" strokeOpacity="0.45" />
        {mode === 'line' ? (
          <>
            <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            {n <= 60 && data.map((d, i) => <circle key={i} cx={x(i)} cy={y(d.v)} r="3.5" fill="var(--bg)" stroke="var(--accent)" strokeWidth="2" />)}
          </>
        ) : (
          data.map((d, i) => {
            const bw = Math.min(48, slot * 0.7)
            return <rect key={i} x={bx(i) - bw / 2} y={Math.min(y(d.v), y(0))} width={bw} height={Math.max(2, Math.abs(y(d.v) - y(0)))} rx="2" fill={d.v >= 0 ? 'var(--win)' : 'var(--loss)'} />
          })
        )}
        <text x={PAD.l} y={H - 8} fontSize="11" fill="var(--muted)">{data[0].label}</text>
        {n > 1 && <text x={W - PAD.r} y={H - 8} fontSize="11" fill="var(--muted)" textAnchor="end">{data[n - 1].label}</text>}
        {hover != null && <line x1={mode === 'bar' ? bx(hover) : x(hover)} x2={mode === 'bar' ? bx(hover) : x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="var(--muted)" strokeOpacity="0.5" />}
      </svg>
      {hp && (
        <div className="panel" style={{ position: 'absolute', top: 8, left: 12, pointerEvents: 'none', padding: '8px 12px', fontSize: 12 }}>
          <div className="muted">{hp.label}</div>
          <strong>{fmt(hp.value)}</strong>
        </div>
      )}
    </div>
  )
}
