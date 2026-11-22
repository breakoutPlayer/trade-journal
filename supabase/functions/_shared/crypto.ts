// AES-GCM encryption of exchange credentials. The key comes from the ENCRYPTION_KEY function secret
// (32 random bytes, base64). It is never stored in the database or in git.

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

let cached: CryptoKey | null = null
async function key(): Promise<CryptoKey> {
  if (cached) return cached
  const raw = Deno.env.get('ENCRYPTION_KEY')
  if (!raw) throw new Error('Server is missing ENCRYPTION_KEY')
  const bytes = unb64(raw)
  if (bytes.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes, base64-encoded')
  cached = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
  return cached
}

/**
 * Encrypts with a fresh random 96-bit IV every call. `aad` (the connection id) is authenticated
 * but not encrypted, so a ciphertext copied onto another connection row fails to decrypt.
 */
export async function encryptJson(value: unknown, aad: string): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = new TextEncoder().encode(JSON.stringify(value))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad) }, await key(), data))
  return { ciphertext: b64(ct), iv: b64(iv) }
}

export async function decryptJson<T>(ciphertext: string, iv: string, aad: string): Promise<T> {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: new TextEncoder().encode(aad) }, await key(), unb64(ciphertext))
  return JSON.parse(new TextDecoder().decode(pt)) as T
}

export async function sha256Hex(s: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function hmac(secret: string, msg: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg)))
}
export const hmacHex = async (secret: string, msg: string) =>
  [...(await hmac(secret, msg))].map((b) => b.toString(16).padStart(2, '0')).join('')
export const hmacB64 = async (secret: string, msg: string) => b64(await hmac(secret, msg))
