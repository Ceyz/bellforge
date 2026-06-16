export type RouteId = 'psbt' | 'pool'
export type RouteMetrics = { route: RouteId; price: number | null; slippagePct: number | null }

/** Illustrative top-of-book mid (matches Trade's labelled preview book). NOT live. */
const MID = 0.0045

/** PSBT estimate from the illustrative book. null for amount<=0. */
export function psbtMetrics(amountIn: number): RouteMetrics {
  if (!amountIn || amountIn <= 0) return { route: 'psbt', price: null, slippagePct: null }
  const slip = Math.min(0.9, 0.1 + amountIn / 50000)
  return { route: 'psbt', price: MID * (1 + slip / 100), slippagePct: slip }
}

/** Pools are R&D — NO simulation, NO projection. Always null today. */
export function poolMetrics(): RouteMetrics {
  return { route: 'pool', price: null, slippagePct: null }
}

/** Best execution = lowest slippage. Pool null ⇒ PSBT always wins (today). */
export function smartRoute(amountIn: number): RouteId {
  const p = psbtMetrics(amountIn)
  const q = poolMetrics()
  if (q.slippagePct == null) return 'psbt'
  return q.slippagePct <= (p.slippagePct ?? Infinity) ? 'pool' : 'psbt'
}

export const fmtPrice = (v: number | null) => (v == null ? '—' : v.toFixed(5))
export const fmtPct = (v: number | null) => (v == null ? '—' : `${v.toFixed(1)}%`)
