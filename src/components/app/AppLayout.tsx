import { Link, NavLink } from 'react-router-dom'
import { motion } from 'motion/react'
import { ForgeMark, Wordmark } from '../ui/Brand'
import { EmberDot } from '../ui/EmberDot'
import { ConnectWallet } from './ConnectWallet'
import { AppOutlet } from '../../App'

const NAV = [
  { to: '/app', label: 'Portfolio', end: true },
  { to: '/app/token', label: 'Tokens', end: false },
  { to: '/app/deploy', label: 'Deploy', end: false },
  { to: '/app/trade', label: 'Trade', end: false },
  { to: '/app/pools', label: 'Pools', end: false },
  { to: '/app/lend', label: 'Lend', end: false },
]

/** Nav links with a shared-layout sliding underline. `idSuffix` keeps the
    desktop and mobile navs' indicators independent (both are mounted). */
function NavLinks({ idSuffix }: { idSuffix: string }) {
  return (
    <>
      {NAV.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.end}
          className="relative whitespace-nowrap rounded-btn px-3.5 py-2 text-sm font-medium transition"
        >
          {({ isActive }) => (
            <span className={isActive ? 'text-text-hi' : 'text-text-mid hover:text-text-hi'}>
              {n.label}
              {isActive && (
                <motion.span
                  layoutId={`nav-underline-${idSuffix}`}
                  className="absolute inset-x-2 -bottom-0.5 h-0.5 rounded-pill bg-gradient-to-r from-forge-500 to-bell-300"
                  transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                />
              )}
            </span>
          )}
        </NavLink>
      ))}
    </>
  )
}

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
            <NavLinks idSuffix="d" />
          </nav>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-1.5 rounded-full bg-ink-700 px-2.5 py-1 text-xs font-medium text-text-mid ring-1 ring-ink-600 sm:inline-flex">
              <EmberDot /> regtest
            </span>
            <ConnectWallet />
          </div>
        </div>
        <nav className="flex items-center gap-1 overflow-x-auto px-5 pb-2 md:hidden">
          <NavLinks idSuffix="m" />
        </nav>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-12">
        <AppOutlet />
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
