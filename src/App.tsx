import { configMissing } from './lib/supabase'

export default function App() {
  if (configMissing) {
    return (
      <div className="center-card">
        <h1>Tidemark</h1>
        <p>Missing Supabase keys. Copy <code>.env.example</code> to <code>.env.local</code> and fill in your values, then restart <code>npm run dev</code>.</p>
      </div>
    )
  }
  return <div className="center-card"><h1>Tidemark</h1><p>Connected config found.</p></div>
}
