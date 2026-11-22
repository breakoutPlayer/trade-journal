import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

/** Service-role client. Only ever used inside Edge Functions; the key is injected by Supabase. */
export function admin(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Verifies the JWT with Supabase Auth and returns the user's id, or null. Never trust a user id from the body. */
export async function userIdFrom(req: Request, db: SupabaseClient): Promise<string | null> {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  const { data, error } = await db.auth.getUser(jwt)
  return error ? null : data.user?.id ?? null
}

/** Constant-time string comparison (compares SHA-256 digests so length is not leaked either). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder()
  const [ha, hb] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))])
  const x = new Uint8Array(ha), y = new Uint8Array(hb)
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]
  return diff === 0
}

/**
 * Per-user rate limit backed by the `rate_limits` table (service-role only).
 * Returns true if the action is allowed and records it.
 */
export async function allowAction(db: SupabaseClient, userId: string, action: string, max: number, windowMs: number): Promise<boolean> {
  const since = new Date(Date.now() - windowMs).toISOString()
  const { count, error } = await db.from('rate_limits').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).eq('action', action).gte('at', since)
  if (error) return false // fail closed
  if ((count ?? 0) >= max) return false
  await db.from('rate_limits').insert({ user_id: userId, action })
  return true
}

// Set ALLOWED_ORIGIN (e.g. https://<you>.github.io) as a function secret to lock CORS to your site.
const ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? '*'
export const cors = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

/** Removes any credential value that might have been echoed back in an error message. */
export function redact(msg: string, secrets: (string | undefined)[]): string {
  let out = msg
  for (const s of secrets) if (s && s.length >= 6) out = out.split(s).join('[redacted]')
  return out.slice(0, 500)
}
