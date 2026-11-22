import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { configMissing, supabase } from './lib/supabase'
import { fetchTrades } from './lib/trades'
import { downloadBackup } from './lib/backup'
import type { Trade } from './lib/types'
import { Login } from './pages/Login'
import { TradeLog } from './pages/TradeLog'
import { Import } from './pages/Import'
import { Dashboard } from './pages/Dashboard'
import { Calendar } from './pages/Calendar'
import { Analytics } from './pages/Analytics'
import { Logo } from './components/Logo'
import { NavIcon } from './components/NavIcon'

const TABS = ['Dashboard', 'Trades', 'Calendar', 'Analytics', 'Import'] as const
const TAB_LABELS: Record<(typeof TABS)[number], string> = { Dashboard: 'Dashboard', Trades: 'Trades', Calendar: 'Calendar', Analytics: 'Reports', Import: 'Import' }
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
          Supabase keys are missing or invalid. Locally, copy <code>.env.example</code> to <code>.env.local</code>,
          fill in your values, then restart <code>npm run dev</code>. On GitHub Pages, check the repository secrets
          contain only the value (e.g. <code>https://xxxx.supabase.co</code>), not <code>NAME=value</code>.
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
            <button key={t} className={t === tab ? 'active' : ''} onClick={() => setTab(t)} title={TAB_LABELS[t]} aria-label={TAB_LABELS[t]}>
              <NavIcon name={t} />
              <span className="nav-text">{TAB_LABELS[t]}</span>
            </button>
          ))}
        </nav>
        <div className="account">
          <span className="who">{session.user.email}</span>
          <button onClick={() => downloadBackup(trades)} disabled={!trades.length} title="Download all trades as JSON">
            <span className="nav-text">Backup</span><NavIcon name="Import" />
          </button>
          <button onClick={() => supabase.auth.signOut()} title="Sign out" aria-label="Sign out"><span className="nav-text">Sign out</span><span className="avatar" aria-hidden="true">{(session.user.email ?? '?')[0].toUpperCase()}</span></button>
        </div>
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
