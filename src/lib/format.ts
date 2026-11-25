const money = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function fmtMoney(n: number, signed = true) {
  const s = money.format(Math.abs(n))
  if (!signed) return (n < 0 ? '-' : '') + s
  return (n > 0 ? '+' : n < 0 ? '-' : '') + s
}

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })

/** Short signed amount for tight spaces, e.g. +1.2K */
export function fmtMoneyShort(n: number) {
  const a = Math.abs(n)
  const s = a < 100 ? String(Math.round(a * 10) / 10) : a < 1000 ? String(Math.round(a)) : compact.format(a)
  return (n > 0 ? '+' : n < 0 ? '-' : '') + s
}

export function fmtNum(n: number | null | undefined) {
  if (n === null || n === undefined) return '—'
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 8 })
}

export function fmtPct(n: number) {
  return `${(n * 100).toFixed(1)}%`
}

export function fmtDateTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function pnlClass(n: number) {
  return n > 0 ? 'win' : n < 0 ? 'loss' : ''
}

/** ISO string -> value for <input type="datetime-local"> (local time). */
export function toLocalInput(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}

export function fromLocalInput(v: string) {
  return v ? new Date(v).toISOString() : null
}

export function parseTags(s: string) {
  return [...new Set(s.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))]
}

/** Dollars with the sign before the $, e.g. -$221.35 (same style as the dashboard drawdown cards). */
export function fmtUsd(n: number) {
  return `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
