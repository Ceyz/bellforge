import { useLocation, useOutlet, Routes, Route, Navigate } from 'react-router-dom'
import { AnimatePresence } from 'motion/react'
import { Landing } from './pages/Landing'
import { AppLayout } from './components/app/AppLayout'
import { Portfolio } from './pages/Portfolio'
import { Token } from './pages/Token'
import { TokensList } from './pages/TokensList'
import { Deploy } from './pages/Deploy'
import { Trade } from './pages/Trade'
import { Pools } from './pages/Pools'
import { Lend } from './pages/Lend'
import { PageTransition } from './components/ui/PageTransition'

/**
 * Top-level transition: animates between the Landing ('/') and the app shell
 * ('/app/*'). We key the AnimatePresence child by the *section* (landing vs
 * app), NOT the full pathname — switching /app/mint → /app/trade must NOT
 * remount AppLayout (header, wallet, nav). Those sub-pages are animated one
 * level down, inside AppLayout (see AppLayout's <Outlet> wrapper).
 *
 * HashRouter note: useLocation() returns the hash-derived pathname here, so the
 * keyed-child + AnimatePresence pattern works unchanged under HashRouter.
 */
export default function App() {
  const location = useLocation()
  // Collapse every /app/* path to one key so the shell persists across sub-nav.
  const sectionKey = location.pathname.startsWith('/app') ? 'app' : 'landing'

  return (
    <>
      {/* Shared molten gradient — referenced as url(#molten-fill) by MoltenGauge,
          Crucible, etc. without each re-defining it. Zero-size, off-screen. */}
      <svg aria-hidden width="0" height="0" className="absolute" style={{ position: 'absolute' }}>
        <defs>
          <linearGradient id="molten-fill" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--color-forge-600)" />
            <stop offset="0.5" stopColor="var(--color-forge-500)" />
            <stop offset="1" stopColor="var(--color-bell-300)" />
          </linearGradient>
        </defs>
      </svg>
      <AnimatePresence mode="wait" initial={false}>
        {/* The key drives mount/unmount; Routes still matches on the real location. */}
        <Routes location={location} key={sectionKey}>
          <Route
            path="/"
            element={
              <PageTransition stagger={false}>
                <Landing />
              </PageTransition>
            }
          />
        <Route path="/app" element={<AppLayout />}>
          <Route index element={<Portfolio />} />
          <Route path="token" element={<TokensList />} />
          <Route path="token/:sym" element={<Token />} />
          <Route path="deploy" element={<Deploy />} />
          {/* legacy /app/mint bookmarks → the renamed Deploy page */}
          <Route path="mint" element={<Navigate to="/app/deploy" replace />} />
          <Route path="trade" element={<Trade />} />
          <Route path="pools" element={<Pools />} />
          <Route path="lend" element={<Lend />} />
        </Route>
          <Route
            path="*"
            element={
              <PageTransition stagger={false}>
                <Landing />
              </PageTransition>
            }
          />
        </Routes>
      </AnimatePresence>
    </>
  )
}

/**
 * Renders the matched child route for AppLayout's <Outlet>, wrapped in its own
 * AnimatePresence so app sub-pages (Portfolio/Mint/Trade/Pools/Lend) cross-fade
 * + stagger independently of the persistent shell.
 *
 * AppLayout imports and renders <AppOutlet/> in place of <Outlet/>.
 */
export function AppOutlet() {
  const location = useLocation()
  const outlet = useOutlet()
  return (
    <AnimatePresence mode="wait" initial={false}>
      <PageTransition key={location.pathname}>{outlet}</PageTransition>
    </AnimatePresence>
  )
}
