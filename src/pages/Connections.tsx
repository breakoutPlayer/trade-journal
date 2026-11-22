import { useCallback, useEffect, useState } from 'react'
import {
  EXCHANGES, addConnection, deleteConnection, fetchConnections, fetchRuns, setEnabled, syncNow,
  type Connection, type ExchangeId, type SyncRun,
} from '../lib/connections'
import { fmtDateTime } from '../lib/format'

interface Props {
  reload: () => void // reloads trades after a sync
}

const empty = { label: '', apiKey: '', apiSecret: '', passphrase: '', confirmReadOnly: false }

export function Connections({ reload }: Props) {
  const [conns, setConns] = useState<Connection[]>([])
  const [runs, setRuns] = useState<SyncRun[]>([])
  const [loadError, setLoadError] = useState('')
  const [exchange, setExchange] = useState<ExchangeId>('bitunix')
  const [form, setForm] = useState(empty)
  const [busy, setBusy] = useState<string | null>(null) // id of the action in progress
  const [message, setMessage] = useState<{ kind: 'notice' | 'error'; text: string } | null>(null)

  const refresh = useCallback(() => {
    Promise.all([fetchConnections(), fetchRuns()])
      .then(([c, r]) => { setConns(c); setRuns(r); setLoadError('') })
      .catch((e: Error) => setLoadError(
        /exchange_connections|sync_runs/.test(e.message)
          ? 'The sync tables are missing. Run the SQL in supabase/migrations (see README â†’ "Exchange auto-sync").'
          : e.message,
      ))
  }, [])
  useEffect(refresh, [refresh])

  const ex = EXCHANGES[exchange]
  const canSave = form.label.trim() && form.apiKey.trim() && form.apiSecret.trim() &&
    (!ex.passphrase || form.passphrase.trim()) && (exchange !== 'bitunix' || form.confirmReadOnly)

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setBusy('add'); setMessage(null)
    try {
      await addConnection({ exchange, ...form, passphrase: ex.passphrase ? form.passphrase : undefined })
      setForm(empty) // never keep secrets in state longer than needed
      setMessage({ kind: 'notice', text: 'Connected. Running the first sync (last 90 days)â€¦' })
      refresh()
      const res = await syncNow()
      const total = Object.values(res?.results ?? {}).reduce((s: number, r) => s + ((r as { new_count?: number }).new_count ?? 0), 0)
      setMessage({ kind: 'notice', text: `Connected. First sync added ${total} trade(s).` })
      reload()
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message })
    }
    setBusy(null)
    refresh()
  }

  async function sync(id?: string) {
    setBusy(id ?? 'all'); setMessage(null)
    try {
      const res = await syncNow(id)
      const list = Object.values(res?.results ?? {}) as { status: string; new_count: number; error?: string }[]
      const total = list.reduce((s, r) => s + r.new_count, 0)
      const failed = list.filter((r) => r.status !== 'ok')
      setMessage(failed.length
        ? { kind: 'error', text: `Sync finished with ${failed.length} error(s): ${failed.map((f) => f.error).join('; ')}` }
        : { kind: 'notice', text: `Sync done: +${total} new trade(s).` })
      reload()
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message })
    }
    setBusy(null)
    refresh()
  }

  async function remove(c: Connection) {
    if (!confirm(`Remove "${EXCHANGES[c.exchange].label} Â· ${c.label}"? The stored API key is deleted. Trades already synced are kept.`)) return
    setBusy(c.id)
    try { await deleteConnection(c.id) } catch (err) { setMessage({ kind: 'error', text: (err as Error).message }) }
    setBusy(null)
    refresh()
  }

  async function toggle(c: Connection) {
    try { await setEnabled(c.id, !c.enabled) } catch (err) { setMessage({ kind: 'error', text: (err as Error).message }) }
    refresh()
  }

  const labelOf = (id: string) => {
    const c = conns.find((x) => x.id === id)
    return c ? `${EXCHANGES[c.exchange].label} Â· ${c.label}` : 'Removed'
  }

  return (
    <>
      <h1>Connections</h1>
      <p className="muted">
        Trades are pulled automatically every hour from read-only API keys. Keys are encrypted on the server and never
        sent back to this page. Only closed positions are imported.
      </p>

      {loadError && <div className="panel error">{loadError}</div>}
      {message && <div className={`panel ${message.kind}`}>{message.text}</div>}

      <div className="panel">
        <div className="row" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Connected accounts</h2>
          <span className="spacer" />
          <button className="primary" disabled={!!busy || !conns.some((c) => c.enabled)} onClick={() => sync()}>
            {busy === 'all' ? 'Syncingâ€¦' : 'Sync all now'}
          </button>
        </div>
        {conns.length === 0 ? (
          <p className="muted">No connections yet. Add one below.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Exchange</th>
                  <th>Account</th>
                  <th>Status</th>
                  <th>Last sync</th>
                  <th className="num">Last +new</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {conns.map((c) => (
                  <tr key={c.id}>
                    <td>{EXCHANGES[c.exchange]?.label ?? c.exchange}</td>
                    <td>{c.label}</td>
                    <td>
                      {!c.enabled ? <span className="muted">Paused</span>
                        : c.last_status === 'error' ? <span className="loss" title={c.last_error ?? ''}>Error</span>
                        : c.last_status === 'running' ? 'Syncingâ€¦'
                        : c.last_status === 'ok' ? <span className="win">OK</span> : <span className="muted">Not synced</span>}
                      {c.last_status === 'error' && c.last_error && <div className="muted" style={{ fontSize: 12, maxWidth: 320 }}>{c.last_error}</div>}
                    </td>
                    <td>{c.last_synced_at ? fmtDateTime(c.last_synced_at) : 'â€”'}</td>
                    <td className="num">{c.last_new_count ?? 'â€”'}</td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      <button disabled={!!busy || !c.enabled} onClick={() => sync(c.id)}>{busy === c.id ? 'Syncingâ€¦' : 'Sync now'}</button>{' '}
                      <button disabled={!!busy} onClick={() => toggle(c)}>{c.enabled ? 'Pause' : 'Resume'}</button>{' '}
                      <button disabled={!!busy} onClick={() => remove(c)}>Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <form className="panel" onSubmit={add} autoComplete="off">
        <h2 style={{ marginTop: 0 }}>Add a connection</h2>
        <div className="grid-form stack-sm">
          <label>
            Exchange
            <select value={exchange} onChange={(e) => { setExchange(e.target.value as ExchangeId); setForm({ ...form, confirmReadOnly: false }) }}>
              {(Object.keys(EXCHANGES) as ExchangeId[]).map((id) => <option key={id} value={id}>{EXCHANGES[id].label}</option>)}
            </select>
          </label>
          <label>
            Account label
            <input value={form.label} maxLength={40} placeholder="Main" onChange={(e) => setForm({ ...form, label: e.target.value })} />
          </label>
          <label>
            API key
            <input type="password" value={form.apiKey} autoComplete="off" spellCheck={false} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
          </label>
          <label>
            API secret
            <input type="password" value={form.apiSecret} autoComplete="off" spellCheck={false} onChange={(e) => setForm({ ...form, apiSecret: e.target.value })} />
          </label>
          {ex.passphrase && (
            <label>
              API passphrase
              <input type="password" value={form.passphrase} autoComplete="off" spellCheck={false} onChange={(e) => setForm({ ...form, passphrase: e.target.value })} />
            </label>
          )}
          {exchange === 'bitunix' && (
            <label className="wide" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={form.confirmReadOnly} onChange={(e) => setForm({ ...form, confirmReadOnly: e.target.checked })} />
              I confirm this key is read-only: trading and withdrawals are disabled.
            </label>
          )}
        </div>
        <p className="muted">{ex.guide}</p>
        <button className="primary" type="submit" disabled={!canSave || !!busy}>{busy === 'add' ? 'Checking keyâ€¦' : 'Connect'}</button>
      </form>

      {runs.length > 0 && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Recent syncs</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>When</th><th>Account</th><th>Result</th><th className="num">New trades</th></tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td>{fmtDateTime(r.started_at)}</td>
                    <td>{labelOf(r.connection_id)}</td>
                    <td>{r.status === 'ok' ? <span className="win">OK</span> : r.status === 'error' ? <span className="loss" title={r.error ?? ''}>Error{r.error ? `: ${r.error}` : ''}</span> : r.status}</td>
                    <td className="num">{r.new_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}
