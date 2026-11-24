import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CandlestickSeries, ColorType, CrosshairMode, LineStyle, createChart, createSeriesMarkers,
  type SeriesMarker, type Time, type UTCTimestamp,
} from 'lightweight-charts'
import { supabase } from '../lib/supabase'
import type { Trade } from '../lib/types'

interface Candle { t: number; o: number; h: number; l: number; c: number }
interface Result { source: string; interval: string; candles: Candle[] }

const HOUR = 3600e3
const MAX_SPAN = 25 * 24 * HOUR - HOUR // stay under the candles function's 25-day limit

/** Heikin-Ashi candles from regular OHLC (oldest first). */
export function heikinAshi(candles: Candle[]): Candle[] {
  const out: Candle[] = []
  for (const k of candles) {
    const c = (k.o + k.h + k.l + k.c) / 4
    const prev = out[out.length - 1]
    const o = prev ? (prev.o + prev.c) / 2 : (k.o + k.c) / 2
    out.push({ t: k.t, o, h: Math.max(k.h, o, c), l: Math.min(k.l, o, c), c })
  }
  return out
}

/** Window around the trade: some context before entry and after exit. */
function windowFor(t: Trade): [number, number] | null {
  const open = t.opened_at ? Date.parse(t.opened_at) : null
  const close = t.closed_at ? Date.parse(t.closed_at) : null
  const a = open ?? close, b = close ?? open
  if (a == null || b == null) return null
  const pad = Math.max((b - a) * 0.5, 8 * HOUR)
  const now = Math.floor(Date.now() / 300e3) * 300e3
  const to = Math.min(Math.ceil((b + pad) / 60e3) * 60e3, now)
  const from = Math.max(Math.floor((a - pad) / 60e3) * 60e3, to - MAX_SPAN)
  return [from, to]
}

// lightweight-charts shows UTC; shift so the axis reads in the viewer's local time.
const local = (ms: number) => (Math.floor(ms / 1000) - new Date(ms).getTimezoneOffset() * 60) as UTCTimestamp

const cache = new Map<string, Result>()

export type CandleLoader = (req: { symbol: string; exchange: string | null; from: number; to: number }) => Promise<Result>

/** Default loader: the `candles` Edge Function (public market data, needs a signed-in user). */
export const loadCandles: CandleLoader = async (req) => {
  const { data, error } = await supabase.functions.invoke('candles', { body: req })
  if (error) {
    let msg = error.message
    try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) msg = j.error } catch { /* keep */ }
    throw new Error(msg)
  }
  return data as Result
}

/** Candlestick chart of the pair around the trade, with entry/exit markers and target/stop lines. */
export function PriceChart({ trade, loader = loadCandles }: { trade: Trade; loader?: CandleLoader }) {
  const box = useRef<HTMLDivElement>(null)
  const [data, setData] = useState<Result | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const win = useMemo(() => windowFor(trade), [trade.opened_at, trade.closed_at]) // eslint-disable-line react-hooks/exhaustive-deps
  const key = win ? `${trade.exchange}|${trade.symbol}|${win[0]}|${win[1]}` : ''

  // Fetch candles (cached per trade window for this session).
  useEffect(() => {
    if (!win) return
    const hit = cache.get(key)
    if (hit) { setData(hit); setError(''); return }
    let gone = false
    setLoading(true); setError(''); setData(null)
    loader({ symbol: trade.symbol, exchange: trade.exchange, from: win[0], to: win[1] })
      .then((d) => { if (!gone) { cache.set(key, d); setData(d) } })
      .catch((e: Error) => { if (!gone) setError(e.message) })
      .finally(() => { if (!gone) setLoading(false) })
    return () => { gone = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // Draw.
  useEffect(() => {
    const el = box.current
    if (!el || !data) return
    const css = getComputedStyle(document.documentElement)
    const v = (name: string, fb: string) => css.getPropertyValue(name).trim() || fb
    const win = v('--win', '#4fb985'), loss = v('--loss', '#e15b4f'), muted = v('--muted', '#9a9aa4'), line = v('--line', '#2b2b30')

    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: muted, fontSize: 11 },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      rightPriceScale: { borderColor: line },
      timeScale: { borderColor: line, timeVisible: true, secondsVisible: false },
      crosshair: { mode: CrosshairMode.Normal },
    })
    const series = chart.addSeries(CandlestickSeries, {
      upColor: win, downColor: loss, borderVisible: false, wickUpColor: win, wickDownColor: loss,
    })
    series.setData(heikinAshi(data.candles).map((c) => ({ time: local(c.t), open: c.o, high: c.h, low: c.l, close: c.c })))

    // Snap a timestamp to the candle that contains it.
    const snap = (ms: number) => {
      let best = data.candles[0]
      for (const c of data.candles) if (c.t <= ms) best = c
      return local(best.t)
    }
    const long = trade.side !== 'short'
    const markers: SeriesMarker<Time>[] = []
    if (trade.opened_at && trade.entry_price != null)
      markers.push({ time: snap(Date.parse(trade.opened_at)), position: long ? 'belowBar' : 'aboveBar', shape: long ? 'arrowUp' : 'arrowDown', color: '#d9c3a0', text: `Entry ${trade.entry_price}` })
    if (trade.closed_at && trade.exit_price != null)
      markers.push({ time: snap(Date.parse(trade.closed_at)), position: long ? 'aboveBar' : 'belowBar', shape: long ? 'arrowDown' : 'arrowUp', color: '#e8e8ea', text: `Exit ${trade.exit_price}` })
    markers.sort((a, b) => Number(a.time) - Number(b.time))
    createSeriesMarkers(series, markers)

    const price = (p: number | null | undefined, color: string, title: string, style = LineStyle.Dashed) =>
      p != null && series.createPriceLine({ price: Number(p), color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title })
    price(trade.entry_price, '#d9c3a0', 'Entry', LineStyle.Solid)
    price(trade.exit_price, '#e8e8ea', 'Exit', LineStyle.Solid)
    for (const t of trade.targets ?? []) price(t, win, 'Target')
    for (const s of trade.stops ?? []) price(s, loss, 'Stop')

    chart.timeScale().fitContent()
    return () => chart.remove()
  }, [data, trade])

  if (!win) return <p className="muted pc-msg">Add an open or close time to this trade to see the price chart.</p>
  return (
    <div className="pc">
      <div className="pc-head">
        <b>{trade.symbol}USDT</b>
        {data && <span className="muted">{data.interval} Heikin-Ashi · {data.source} · times in your local zone</span>}
        <span className="spacer" />
        <span className="pc-key"><i style={{ background: '#d9c3a0' }} />Entry <i style={{ background: '#e8e8ea' }} />Exit</span>
      </div>
      {loading && <p className="muted pc-msg">Loading price data…</p>}
      {error && <p className="error pc-msg">{error}</p>}
      <div ref={box} className="pc-chart" style={{ display: data ? 'block' : 'none' }} />
    </div>
  )
}
