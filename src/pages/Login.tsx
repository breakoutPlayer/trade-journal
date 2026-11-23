import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { Logo } from '../components/Logo'

// Sign-in only: new sign-ups are disabled in Supabase (Authentication → Sign In / Providers).
export function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setBusy(false)
  }

  return (
    <div className="center-card">
      <Logo />
      <p>Your trading journal. Sign in to continue.</p>
      <form onSubmit={submit}>
        <label>
          Email
          <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password
          <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <div className="error">{error}</div>}
        <button className="primary" disabled={busy}>{busy ? 'Please wait…' : 'Sign in'}</button>
      </form>
    </div>
  )
}
