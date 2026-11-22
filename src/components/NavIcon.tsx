const PATHS: Record<string, string> = {
  Dashboard: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  Trades: 'M4 5h16M4 12h16M4 19h16',
  Calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  Journal: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5',
  Analytics:'M4 20V10M10 20V4M16 20v-7M22 20H2',
  Import: 'M12 3v12M7 10l5 5 5-5M4 20h16',
}

export function NavIcon({ name }: { name: string }) {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  )
}
