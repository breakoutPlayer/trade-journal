// Add or delete an exchange connection. Secrets arrive here once, are checked for read-only
// permission, encrypted, and stored where the browser can never read them back.
import { encryptJson } from '../_shared/crypto.ts'
import { ADAPTERS } from '../_shared/exchanges/index.ts'
import { admin, allowAction, cors, json, redact, userIdFrom } from '../_shared/supabase.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const db = admin()
  const userId = await userIdFrom(req, db)
  if (!userId) return json({ error: 'Not signed in' }, 401)

  let body: any
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  if (body.action === 'delete') {
    // Trades stay; the cascade removes the encrypted secret and sync history.
    if (typeof body.id !== 'string') return json({ error: 'Missing id' }, 400)
    const { error } = await db.from('exchange_connections').delete().eq('id', body.id).eq('user_id', userId)
    return error ? json({ error: error.message }, 400) : json({ ok: true })
  }

  if (body.action !== 'add') return json({ error: 'Unknown action' }, 400)

  const adapter = ADAPTERS[body.exchange]
  if (!adapter) return json({ error: 'Unsupported exchange' }, 400)
  const label = String(body.label ?? '').trim().slice(0, 40)
  const apiKey = String(body.apiKey ?? '').trim()
  const apiSecret = String(body.apiSecret ?? '').trim()
  const passphrase = String(body.passphrase ?? '').trim()
  if (!label || !apiKey || !apiSecret) return json({ error: 'Label, API key and secret are required' }, 400)
  if (adapter.needsPassphrase && !passphrase) return json({ error: `${adapter.label} needs the API passphrase` }, 400)
  if (adapter.id === 'bitunix' && body.confirmReadOnly !== true)
    return json({ error: 'Confirm that this Bitunix key is read-only (no trading, no withdrawals)' }, 400)

  // Rate limit key checks: stops the function being used to brute-force or probe keys,
  // and protects the exchange-side IP from bans.
  if (!(await allowAction(db, userId, 'key_check', 5, 15 * 60_000)))
    return json({ error: 'Too many key checks. Wait 15 minutes and try again.' }, 429)

  const creds = { apiKey, apiSecret, ...(passphrase ? { passphrase } : {}) }
  try {
    const check = await adapter.checkPermissions(creds)
    if (!check.ok) return json({ error: check.reason }, 400)
  } catch (e) {
    return json({ error: `Could not verify the key: ${redact((e as Error).message, [apiKey, apiSecret, passphrase])}` }, 400)
  }

  const { data: conn, error } = await db.from('exchange_connections')
    .insert({ user_id: userId, exchange: adapter.id, label })
    .select('id').single()
  if (error) return json({ error: error.code === '23505' ? 'A connection with this label already exists' : error.message }, 400)

  const enc = await encryptJson(creds, conn.id)
  const { error: secErr } = await db.from('exchange_secrets').insert({ connection_id: conn.id, ...enc })
  if (secErr) {
    await db.from('exchange_connections').delete().eq('id', conn.id)
    return json({ error: 'Could not store the key' }, 500)
  }
  return json({ ok: true, id: conn.id })
})
