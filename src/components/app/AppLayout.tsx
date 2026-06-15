import { Link, NavLink, Outlet } from 'react-router-dom'
import { ForgeMark, Wordmark } from '../ui/Brand'
import { ConnectWallet } from './ConnectWallet'

const NAV = [
  { to: '/app', label: 'Portfolio', end: true },
  { to: '/app/mint', label: 'Mint', end: false },
  { to: '/app/trade', label: 'Trade', end: false },
  { to: '/app/pools', label: 'Pools', end: false },
  { to: '/app/lend', label: 'Lend', end: false },
]

const linkCls = ({ isActive }: { isActive: boolean }) =>
  `whitespace-nowrap rounded-btn px-3.5 py-2 text-sm font-medium transition ${
    isActive ? 'bg-ink-700 text-text-hi' : 'text-text-mid hover:bg-ink-700/70 hover:text-text-hi'
  }`

export function AppLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-ink-600/70 bg-ink-900/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link to="/" className="flex items-center gap-2.5">
            <ForgeMark />
            <Wordmark />
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={linkCls}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <span className="hidden rounded-full bg-ink-700 px-2.5 py-1 text-xs font-medium text-text-mid ring-1 ring-ink-600 sm:inline">
              regtest
            </span>
            <ConnectWallet />
          </div>
        </div>
        <nav className="flex items-center gap-1 overflow-x-auto px-5 pb-2 md:hidden">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={linkCls}>
              {n.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-12">
        <Outlet />
      </main>

      <footer className="border-t border-ink-600/70">
        <div className="mx-auto max-w-6xl px-5 py-6 text-sm text-text-lo">
          Bellforge · regtest preview ·{' '}
          <Link to="/" className="transition hover:text-text-hi">
            back to home
          </Link>
        </div>
      </footer>
    </div>
  )
}
