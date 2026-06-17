import { lazy, Suspense } from 'react'
import { useLocation, useOutlet, Routes, Route, Navigate } from 'react-router-dom'
import { AppLayout } from './components/app/AppLayout'
import { ErrorBoundary } from './components/app/ErrorBoundary'
import { PageTransition } from './components/ui/PageTransition'

// Route-level code-splitting: each page is its own chunk so the initial load
// (e.g. straight to /app) doesn't pull the heavy Landing canvas, and vice versa.
// AppLayout stays eager — it's the persistent shell. Pages are NAMED exports, so
// map them to `default` for React.lazy.
const Landing = lazy(() => import('./pages/Landing').then((m) => ({ default: m.Landing })))
const Portfolio = lazy(() => import('./pages/Portfolio').then((m) => ({ default: m.Portfolio })))
const Token = lazy(() => import('./pages/Token').then((m) => ({ default: m.Token })))
const TokensList = lazy(() => import('./pages/TokensList').then((m) => ({ default: m.TokensList })))
const Deploy = lazy(() => import('./pages/Deploy').then((m) => ({ default: m.Deploy })))
const Trade = lazy(() => import('./pages/Trade').then((m) => ({ default: m.Trade })))
const Pools = lazy(() => import('./pages/Pools').then((m) => ({ default: m.Pools })))
const Lend = lazy(() => import('./pages/Lend').then((m) => ({ default: m.Lend })))

/** Lightweight chunk-load fallback (breathing ember). No heavy imports. */
function PageLoader() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center" aria-label="Loading" role="status">
      <span className="ember-dot h-3 w-3 rounded-full bg-forge-500" />
    </div>
  )
}

/**
 * Top-level transition: animates between the Landing ('/') and the app shell
 * ('/app/*'). We key the AnimatePresence child by the *section* (landing vs
 * app), NOT the full pathname — switching /app/mint → /app/trade must NOT
 * remount AppLayout (header, wallet, nav). Those sub-pages are animated one
 * level down, inside AppLayout (see AppLayout's <Outlet> wrapper).
 *
 * HashRouter note: useLocation() returns the hash-derived pathname here, so the
 * keyed-child + AnimatePresence pattern works unchanged under HashRouter.
 *
 * The Suspense wraps AnimatePresence (not its child) so the keyed <Routes> stays
 * AnimatePresence's direct child; sub-page chunk loads use AppOutlet's own
 * Suspense so the shell stays visible.
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
      <Suspense fallback={<PageLoader />}>
        {/* The keyed PageTransition (per route/section) handles the ENTER animation
            on mount. We don't wrap in AnimatePresence: a suspending (lazy) child as
            the direct child of mode="wait" deadlocks the transition, so we drop the
            exit cross-fade for reliability — Suspense shows the loader during a chunk
            load, then the page enter-animates. */}
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
      </Suspense>
    </>
  )
}

/**
 * Renders the matched child route for AppLayout's <Outlet>, wrapped in its own
 * AnimatePresence so app sub-pages (Portfolio/Mint/Trade/Pools/Lend) cross-fade
 * + stagger independently of the persistent shell.
 *
 * The per-page <ErrorBoundary> + <Suspense> live INSIDE the pathname-keyed
 * <PageTransition>, so navigating to another page remounts them — a crashed or
 * still-loading sub-page never strands the shell, and the error clears on nav.
 *
 * AppLayout imports and renders <AppOutlet/> in place of <Outlet/>.
 */
export function AppOutlet() {
  const location = useLocation()
  const outlet = useOutlet()
  // The pathname-keyed PageTransition remounts on nav → its ENTER animation plays
  // each time, and the per-page ErrorBoundary resets. No AnimatePresence: a lazy
  // child under mode="wait" deadlocks the transition. Suspense shows the loader
  // during a chunk load.
  return (
    <Suspense fallback={<PageLoader />}>
      <PageTransition key={location.pathname}>
        <ErrorBoundary>{outlet}</ErrorBoundary>
      </PageTransition>
    </Suspense>
  )
}
