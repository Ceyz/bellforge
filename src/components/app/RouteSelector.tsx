import { useEffect, useMemo, useState } from 'react'
import { RouteCard } from './RouteCard'
import { psbtMetrics, smartRoute, fmtPrice, fmtPct, type RouteId } from '../../lib/routing'

/** PSBT-order-book vs pool route picker. Defaults to "Auto · best execution"
    (lowest slippage). The pool route is shown but R&D-locked until mainnet, so
    today best execution is always the PSBT book. Honest: no simulated pool price. */
export function RouteSelector({ amountIn, onRoute }: { amountIn: number; onRoute?: (r: RouteId) => void }) {
  const [manual, setManual] = useState<RouteId | null>(null)
  const best = useMemo(() => smartRoute(amountIn), [amountIn])
  const selected = manual ?? best
  const psbt = psbtMetrics(amountIn)

  useEffect(() => {
    onRoute?.(selected)
  }, [selected, onRoute])

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-display text-sm text-text-hi">Execution route</span>
        <span className="text-xs text-text-lo">{manual ? 'Manual' : 'Auto · best execution'}</span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <RouteCard
          id="psbt"
          title="Order book (PSBT)"
          status="live-regtest"
          price={fmtPrice(psbt.price)}
          slippage={fmtPct(psbt.slippagePct)}
          selected={selected === 'psbt'}
          onSelect={() => setManual('psbt')}
        />
        <RouteCard
          id="pool"
          title="Liquidity pool"
          status="soon"
          note="Quotes appear once covenant pools launch — no simulated price shown."
          disabled
          selected={selected === 'pool'}
          onSelect={() => setManual('pool')}
        />
      </div>
      {manual && (
        <button type="button" onClick={() => setManual(null)} className="text-xs text-forge-400 transition hover:underline">
          Reset to best execution
        </button>
      )}
    </div>
  )
}
