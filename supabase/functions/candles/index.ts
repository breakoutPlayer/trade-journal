// Public price candles for the trade chart. No API keys: only public market-data endpoints.
// Proxied here because Bitunix doesn't allow browser (CORS) requests.
// POST { symbol: "NVDA", exchange?: "Bitunix", from: ms, to: ms }  ->  { source, interval, candles: [{t,o,h,l,c}] }
import { admin, allowAction, cors, json, userIdFrom } from '../_shared/supabase.ts'
import { getJson } from '../_shared/http.ts'

interface Candle { t: number; o: number; h: number; l: number; c: number }

// Interval choice: aim for roughly 60-200 candles across the requested window.
const INTERVALS: [string, number][] = [
  ['1m', 60e3], ['5m', 300e3], ['15m', 900e3], ['30m', 1800e3], ['1h', 3600e3], ['4h', 14400e3], ['1d', 86400e3],
]
function pickInterval(span: number): [string, number] {
  return INTERVALS.find(([, ms]) => span / ms <= 180) ?? INTERVALS[INTERVALS.length - 1]
}

const num = (v: unknown) => Number(v)

async function bitunix(sym: string, iv: string, from: number, to: number): Promise<Candle[]> {
  // Bitunix honors endTime and returns up to `limit` candles before it (startTime is ignored).
  const out = new Map<number, Candle>()
  let end = to
  for (let i = 0; i < 5; i++) {
    const r = await getJson(`https://fapi.bitunix.com/api/v1/futures/market/kline?symbol=${sym}USDT&interval=${iv}&endTime=${end}&limit=200`, {}, 'Bitunix')
    const rows: any[] = r?.code === 0 ? r.data ?? [] : []
    for (const k of rows) out.set(num(k.time), { t: num(k.time), o: num(k.open), h: num(k.high), l: num(k.low), c: num(k.close) })
    if (rows.length < 200) break
    const oldest = Math.min(...rows.map((k) => num(k.time)))
    if (oldest <= from) break
    end = oldest - 1
  }
  return [...out.values()]
}

async function binance(sym: string, iv: string, from: number, to: number): Promise<Candle[]> {
  const rows: any[] = await getJson(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}USDT&interval=${iv}&startTime=${from}&endTime=${to}&limit=1000`, {}, 'Binance')
  return (rows ?? []).map((k) => ({ t: num(k[0]), o: num(k[1]), h: num(k[2]), l: num(k[3]), c: num(k[4]) }))
}

async function okx(sym: string, iv: string, from: number, to: number): Promise<Candle[]> {
  const bar = iv.endsWith('h') || iv.endsWith('d') ? iv.toUpperCase() : iv // OKX: 1m 5m 15m 30m 1H 4H 1D
  const out = new Map<number, Candle>()
  let after = to + 1
  for (let i = 0; i < 5; i++) {
    const r = await getJson(`https://www.okx.com/api/v5/market/history-candles?instId=${sym}-USDT-SWAP&bar=${bar}&after=${after}&limit=100`, {}, 'OKX')
    const rows: any[] = r?.code === '0' ? r.data ?? [] : []
    for (const k of rows) out.set(num(k[0]), { t: num(k[0]), o: num(k[1]), h: num(k[2]), l: num(k[3]), c: num(k[4]) })
    if (rows.length < 100) break
    const oldest = num(rows[rows.length - 1][0])
    if (oldest <= from) break
    after = oldest
  }
  return [...out.values()]
}

const SOURCES: Record<string, typeof bitunix> = { Bitunix: bitunix, Binance: binance, OKX: okx }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const db = admin()
  const userId = await userIdFrom(req, db)
  if (!userId) return json({ error: 'Not signed in' }, 401)
  if (!(await allowAction(db, userId, 'candles', 60, 10 * 60_000))) return json({ error: 'Too many chart requests. Try again in a few minutes.' }, 429)

  const body = await req.json().catch(() => ({}))
  const symbol = String(body.symbol ?? '').toUpperCase().replace(/(USDT|USDC|USD|PERP|SWAP|[-_/\s])+$/g, '')
  const from = Number(body.from), to = Number(body.to)
  if (!/^[A-Z0-9]{1,20}$/.test(symbol)) return json({ error: 'Invalid symbol' }, 400)
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 400 * 86400e3) return json({ error: 'Invalid time range' }, 400)

  const [iv, ivMs] = pickInterval(to - from)
  // Try the trade's own exchange first, then the others.
  const order = [body.exchange, 'Bitunix', 'Binance', 'OKX'].filter((x, i, a) => typeof x === 'string' && SOURCES[x] && a.indexOf(x) === i) as string[]
  const tried: string[] = []
  for (const name of order) {
    try {
      const candles = (await SOURCES[name](symbol, iv, from, to)).filter((c) => c.t >= from - ivMs && c.t <= to).sort((a, b) => a.t - b.t)
      if (candles.length >= 2) return json({ source: name, interval: iv, candles })
      tried.push(`${name}: no data`)
    } catch (e) {
      tried.push(`${name}: ${(e as Error).message.slice(0, 80)}`)
    }
  }
  return json({ error: `No price data found for ${symbol} in that period.`, tried }, 404)
})
