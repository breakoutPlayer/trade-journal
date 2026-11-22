// OKX perpetual swaps. Docs: https://www.okx.com/docs-v5/en/
// Signing: base64(hmacSHA256(secret, timestamp + METHOD + requestPath(with query) + body))
import { hmacB64 } from '../crypto.ts'
import { getJson, iso, normSymbol, num, r8, sleep } from '../http.ts'
import type { Creds, ExchangeAdapter, SyncedTrade } from './types.ts'

const HOST = 'https://www.okx.com'

async function signedGet(creds: Creds, path: string, params: Record<string, string | number> = {}) {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()
  const requestPath = path + (qs ? '?' + qs : '')
  const ts = new Date().toISOString()
  const sign = await hmacB64(creds.apiSecret, ts + 'GET' + requestPath)
  const body = await getJson(HOST + requestPath, {
    'OK-ACCESS-KEY': creds.apiKey,
    'OK-ACCESS-SIGN': sign,
    'OK-ACCESS-TIMESTAMP': ts,
    'OK-ACCESS-PASSPHRASE': creds.passphrase ?? '',
    'Content-Type': 'application/json',
  }, 'OKX')
  if (body?.code !== '0') throw new Error(`OKX: ${body?.msg || 'request failed'} (code ${body?.code})`)
  return body.data as any[]
}

/** Contract size per instrument (closeTotalPos is in contracts). Public endpoint, no key needed. */
async function contractValues(): Promise<Map<string, number>> {
  const body = await getJson(`${HOST}/api/v5/public/instruments?instType=SWAP`, {}, 'OKX')
  const m = new Map<string, number>()
  for (const i of body?.data ?? []) m.set(i.instId, Number(i.ctVal) || 1)
  return m
}

const FULLY_CLOSED = new Set(['2', '3', '6']) // close all, liquidation, ADL fully closed

export const okx: ExchangeAdapter = {
  id: 'okx',
  label: 'OKX',
  needsPassphrase: true,

  async checkPermissions(creds) {
    const [cfg] = await signedGet(creds, '/api/v5/account/config')
    const perms = String(cfg?.perm ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    const bad = perms.filter((p) => p === 'trade' || p === 'withdraw')
    if (bad.length) return { ok: false, reason: `This OKX key has ${bad.join(' + ')} permission. Create a Read-only key instead.` }
    if (!perms.includes('read_only')) return { ok: false, reason: 'This OKX key does not have Read permission.' }
    return { ok: true }
  },

  async fetchClosedTrades(creds, sinceMs) {
    const ctVal = await contractValues()
    const out: SyncedTrade[] = []
    let after: string | undefined
    for (let page = 0; page < 200; page++) {
      const rows = await signedGet(creds, '/api/v5/account/positions-history', { instType: 'SWAP', limit: 100, ...(after ? { after } : {}) })
      for (const p of rows) {
        const closedMs = Number(p.uTime)
        if (closedMs < sinceMs || !FULLY_CLOSED.has(String(p.type))) continue
        const dir = String(p.direction || p.posSide || '').toLowerCase()
        const contracts = num(p.closeTotalPos) ?? num(p.openMaxPos)
        const fee = num(p.fee) ?? 0 // negative = paid
        out.push({
          external_id: `${p.posId}:${p.cTime}`,
          symbol: normSymbol(String(p.instId)),
          side: dir === 'short' ? 'short' : dir === 'long' ? 'long' : null,
          entry_price: num(p.openAvgPx),
          exit_price: num(p.closeAvgPx),
          size: contracts == null ? null : r8(contracts * (ctVal.get(p.instId) ?? 1)),
          pnl: r8((num(p.pnl) ?? 0) + (num(p.fundingFee) ?? 0) + (num(p.liqPenalty) ?? 0)),
          fees: r8(-fee),
          exchange: 'OKX',
          opened_at: iso(Number(p.cTime)),
          closed_at: iso(closedMs),
        })
      }
      if (rows.length < 100 || Number(rows[rows.length - 1].uTime) < sinceMs) break
      after = rows[rows.length - 1].uTime
      await sleep(250) // 10 req / 2 s limit
    }
    return out
  },
}
