import { useLocation, useOutlet, Routes, Route } from 'react-router-dom'
import { AnimatePresence } from 'motion/react'
import { Landing } from './pages/Landing'
import { AppLayout } from './components/app/AppLayout'
import { Portfolio } from './pages/Portfolio'
import { Token } from './pages/Token'
import { Mint } from './pages/Mint'
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
          <Route path="token" element={<Token />} />
          <Route path="mint" element={<Mint />} />
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
