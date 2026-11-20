import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { configMissing, supabase } from './lib/supabase'
import { Login } from './pages/Login'
import { Logo } from './components/Logo'

const TABS = ['Dashboard'] as const
type Tab = (typeof TABS)[number]

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('Dashboard')

  useEffect(() => {
    if (configMissing) return
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    // Keeps the UI in sync when the user signs in/out or the token refreshes.
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (configMissing) {
    return (
      <div className="center-card">
        <Logo />
        <p>
          Missing Supabase keys. Copy <code>.env.example</code> to <code>.env.local</code>, fill in your values, then
          restart <code>npm run dev</code>.
        </p>
      </div>
    )
  }
  if (loading) return <div className="center-card"><Logo /><p>Loading…</p></div>
  if (!session) return <Login />

  return (
    <>
      <header className="topbar">
        <Logo />
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t} className={t === tab ? 'active' : ''} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </nav>
        <span className="who">{session.user.email}</span>
        <button onClick={() => supabase.auth.signOut()}>Sign out</button>
      </header>
      <main>
        <div className="panel"><p>Signed in. Features coming next.</p></div>
      </main>
    </>
  )
}
