import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { configMissing, supabase } from './lib/supabase'
import { fetchTrades } from './lib/trades'
import type { Trade } from './lib/types'
import { Login } from './pages/Login'
import { TradeLog } from './pages/TradeLog'
import { Import } from './pages/Import'
import { Dashboard } from './pages/Dashboard'
import { Calendar } from './pages/Calendar'
import { Analytics } from './pages/Analytics'
import { Logo } from './components/Logo'

const TABS = ['Dashboard', 'Trades', 'Calendar', 'Analytics', 'Import'] as const
type Tab = (typeof TABS)[number]

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>(TABS[0])
  const [trades, setTrades] = useState<Trade[]>([])
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    if (configMissing) return
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    // Keeps the UI in sync when the user signs in/out or the token refreshes.
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      if (!s) setTrades([]) // signed out: forget the previous user's data
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const reload = useCallback(() => {
    fetchTrades()
      .then((t) => {
        setTrades(t)
        setLoadError('')
      })
      .catch((e: Error) => setLoadError(e.message))
  }, [])

  // Load trades whenever a user signs in.
  const userId = session?.user.id
  useEffect(() => {
    if (userId) reload()
  }, [userId, reload])

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
  if (loading) {
    return (
      <div className="center-card">
        <Logo />
        <p>Loading…</p>
      </div>
    )
  }
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
        {loadError && <div className="panel error">Could not load trades: {loadError}</div>}
        {tab === 'Dashboard' && <Dashboard trades={trades} />}
        {tab === 'Trades' && <TradeLog trades={trades} reload={reload} />}
        {tab === 'Calendar' && <Calendar trades={trades} />}
        {tab === 'Analytics' && <Analytics trades={trades} />}
        {tab === 'Import' && <Import trades={trades} reload={reload} />}
      </main>
    </>
  )
}
