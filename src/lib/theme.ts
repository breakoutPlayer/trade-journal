import { useSyncExternalStore } from 'react'

export type Theme = 'dark' | 'light'

const KEY = 'tidemark.theme'
const listeners = new Set<() => void>()

/** Dark is the default; only an explicit saved "light" switches it. */
export function getTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f4f4f5' : '#101012')
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // Private mode: the choice just lasts until reload.
  }
  applyTheme(theme)
  listeners.forEach((l) => l())
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useTheme(): [Theme, () => void] {
  const theme = useSyncExternalStore(subscribe, () => document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')
  return [theme, () => setTheme(theme === 'light' ? 'dark' : 'light')]
}
