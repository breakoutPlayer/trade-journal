import type { Trade } from './types'
import { dayKey } from './trades'

/** Downloads every trade as a JSON file, e.g. tidemark-backup-2026-11-21.json */
export function downloadBackup(trades: Trade[]) {
  const payload = {
    app: 'Tidemark',
    version: 1,
    exported_at: new Date().toISOString(),
    count: trades.length,
    trades,
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `tidemark-backup-${dayKey(new Date())}.json`
  a.click()
  URL.revokeObjectURL(url)
}
