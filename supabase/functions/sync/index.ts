// Pull closed trades for exchange connections.
// - Browser "Sync now": Authorization: Bearer <user JWT>, body { connectionId? }
// - Hourly cron: header x-cron-secret: <CRON_SECRET>, syncs every enabled connection.
import { decryptJson } from '../_shared/crypto.ts'
import { ADAPTERS } from '../_shared/exchanges/index.ts'
import type { Creds, SyncedTrade } from '../_shared/exchanges/types.ts'
import { admin, allowAction, cors, json, redact, safeEqual, userIdFrom } from '../_shared/supabase.ts'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

const DAY = 86_400_000
const BACKFILL = 90 * DAY
const OVERLAP = DAY

/** Matches CSV-imported rows: exchange + symbol + close time (to the second) + P&L (to the cent). */
const legacyKey = (t: { exchange: string | null; symbol: string; closed_at: string | null; pnl: number | null }) =>
  [t.exchange ?? '', t.symbol, t.closed_at ? Math.round(new Date(t.closed_at).getTime() / 1000) : '', Number(t.pnl ?? 0).toFixed(2)].join('|')

async function legacyKeys(db: SupabaseClient, userId: string, exchange: string) {
  const keys = new Set<string>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('trades').select('exchange,symbol,closed_at,pnl')
      .eq('user_id', userId).eq('exchange', exchange).is('external_id', null).range(from, from + 999)
    if (error) throw error
    data.forEach((t) => keys.add(legacyKey(t)))
    if (data.length < 1000) return keys
  }
}

/** Allowed manual look-back ranges, in days. */
const RANGES = new Set([30, 60, 90])

async function syncOne(db: SupabaseClient, conn: any, days?: number): Promise<{ status: string; new_count: number; error?: string }> {
  const adapter = ADAPTERS[conn.exchange]
  const { data: run } = await db.from('sync_runs').insert({ connection_id: conn.id, user_id: conn.user_id, status: 'running' }).select('id').single()
  await db.from('exchange_connections').update({ last_status: 'running' }).eq('id', conn.id)

  let result: { status: string; new_count: number; error?: string }
  let creds: Creds | null = null
  try {
    if (!adapter) throw new Error(`Unsupported exchange ${conn.exchange}`)
    const { data: sec, error } = await db.from('exchange_secrets').select('ciphertext,iv').eq('connection_id', conn.id).single()
    if (error || !sec) throw new Error('Stored key not found; delete and re-add this connection')
    creds = await decryptJson<Creds>(sec.ciphertext, sec.iv, conn.id)

    // A chosen range re-scans that many days (duplicates are skipped); otherwise continue from the last sync.
    const since = days ? Date.now() - days * DAY
      : conn.last_synced_at ? new Date(conn.last_synced_at).getTime() - OVERLAP : Date.now() - BACKFILL
    const fetched: SyncedTrade[] = await adapter.fetchClosedTrades(creds, since)

    const legacy = fetched.length ? await legacyKeys(db, conn.user_id, fetched[0].exchange) : new Set<string>()
    const rows = fetched
      .filter((t) => !legacy.has(legacyKey(t)))
      .map((t) => ({ ...t, user_id: conn.user_id, account: conn.label, notes: null, tags: [] }))

    let newCount = 0
    for (let i = 0; i < rows.length; i += 500) {
      const { data, error: upErr } = await db.from('trades')
        .upsert(rows.slice(i, i + 500), { onConflict: 'user_id,exchange,account,external_id', ignoreDuplicates: true })
        .select('id')
      if (upErr) throw upErr
      newCount += data?.length ?? 0
    }
    result = { status: 'ok', new_count: newCount }
  } catch (e) {
    // Our wrappers never include keys or signed URLs; redact anyway in case an exchange echoes one back.
    const msg = String((e as Error).message ?? e)
    result = { status: 'error', new_count: 0, error: redact(msg, [creds?.apiKey, creds?.apiSecret, creds?.passphrase]) }
  }

  const now = new Date().toISOString()
  await db.from('exchange_connections').update({
    last_status: result.status,
    last_error: result.error ?? null,
    last_new_count: result.new_count,
    ...(result.status === 'ok' ? { last_synced_at: now } : {}),
  }).eq('id', conn.id)
  if (run) await db.from('sync_runs').update({ finished_at: now, status: result.status, new_count: result.new_count, error: result.error ?? null }).eq('id', run.id)
  return result
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const db = admin()

  // Cron path: requires CRON_SECRET (min 32 chars), compared in constant time.
  const cronSecret = Deno.env.get('CRON_SECRET') ?? ''
  const sent = req.headers.get('x-cron-secret')
  const isCron = sent !== null && cronSecret.length >= 32 && (await safeEqual(sent, cronSecret))
  if (sent !== null && !isCron) return json({ error: 'Forbidden' }, 403)
  let query = db.from('exchange_connections').select('*').eq('enabled', true)
  let days: number | undefined

  if (!isCron) {
    // User path: user_id comes only from the verified JWT.
    const userId = await userIdFrom(req, db)
    if (!userId) return json({ error: 'Not signed in' }, 401)
    if (!(await allowAction(db, userId, 'manual_sync', 6, 10 * 60_000)))
      return json({ error: 'Too many syncs. Wait a few minutes and try again.' }, 429)
    query = query.eq('user_id', userId)
    const body = await req.json().catch(() => ({}))
    if (typeof body?.connectionId === 'string') query = query.eq('id', body.connectionId)
    if (body?.days !== undefined) {
      if (!RANGES.has(body.days)) return json({ error: 'days must be 30, 60 or 90' }, 400)
      days = body.days
    }
  }

  const { data: conns, error } = await query
  if (error) return json({ error: error.message }, 500)

  const results: Record<string, unknown> = {}
  for (const c of conns ?? []) results[c.id] = await syncOne(db, c, days)
  return json({ ok: true, results })
})
