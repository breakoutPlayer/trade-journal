import { createClient } from '@supabase/supabase-js'

const url = (import.meta.env.VITE_SUPABASE_URL ?? '').trim()
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim()

function isHttpUrl(s: string) {
  try {
    return ['http:', 'https:'].includes(new URL(s).protocol)
  } catch {
    return false
  }
}

// A common mistake is pasting the whole "NAME=value" line into a secret.
const looksPasted = (s: string) => /^VITE_[A-Z_]+=/.test(s)

export const configMissing = !url || !key || !isHttpUrl(url) || looksPasted(key)

// Placeholder values keep the app from crashing so we can show a helpful message instead.
export const supabase = createClient(configMissing ? 'http://localhost' : url, configMissing ? 'missing' : key)
