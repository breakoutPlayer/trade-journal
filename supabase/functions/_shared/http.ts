// Fetch wrapper for exchange APIs: timeouts, rate-limit backoff, and errors that never contain
// credentials (we never include headers or signed URLs in error text).

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class ExchangeError extends Error {}

export async function getJson(url: string, headers: Record<string, string>, label: string): Promise<any> {
  const safeUrl = url.split('?')[0] // drop query (may contain signature)
  for (let attempt = 0; attempt < 4; attempt++) {
    let res: Response
    try {
      res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) })
    } catch (e) {
      if (attempt < 3) { await sleep(1000 * 2 ** attempt); continue }
      throw new ExchangeError(`${label}: network error calling ${safeUrl} (${(e as Error).name})`)
    }
    if (res.status === 429 || res.status === 418 || res.status >= 500) {
      if (attempt < 3) { await sleep(Number(res.headers.get('retry-after') ?? 0) * 1000 || 1500 * 2 ** attempt); continue }
    }
    const text = await res.text()
    let body: any
    try { body = JSON.parse(text) } catch { body = null }
    if (!res.ok) {
      const msg = body?.msg ?? body?.message ?? text.slice(0, 200)
      throw new ExchangeError(`${label}: HTTP ${res.status} from ${safeUrl}: ${msg}`)
    }
    return body
  }
  throw new ExchangeError(`${label}: rate limited, try again later`)
}

export { sleep }

/** "BTCUSDT", "BTC-USDT-SWAP" -> "BTC" (same rule as normSymbol in src/lib/importers.ts). */
export function normSymbol(s: string) {
  const u = s.toUpperCase().replace(/[\s/_-]/g, '')
  return u.replace(/(PERP|SWAP)$/, '').replace(/(USDT|USDC|USD)$/, '') || u
}

export const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
export const r8 = (n: number) => Math.round(n * 1e8) / 1e8
export const iso = (ms: number | null | undefined) => (ms ? new Date(Number(ms)).toISOString() : null)
