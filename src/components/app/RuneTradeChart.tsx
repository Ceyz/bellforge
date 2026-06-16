import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { fetchFills, type Fill } from '../../lib/offers'
import type { TokenInfo } from '../../lib/tokens'

/** Price per unit of a settled fill (sats per rune unit). */
const ppu = (f: Fill) => f.price / Math.max(1, Number(f.amount_hint || '0'))
const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 })

/** REAL rune price from settled P2P swaps (the relay's taken offers) — not illustrative.
    Shows the last traded price + a sparkline once ≥2 fills exist. Honest empty state. */
export function RuneTradeChart({ rune }: { rune: TokenInfo }) {
  const reduce = useReducedMotion()
  // Keyed by runeId so `loading` is DERIVED (no synchronous setState in the effect).
  const [data, setData] = useState<{ runeId: string | undefined; fills: Fill[] } | null>(null)

  useEffect(() => {
    let alive = true
    fetchFills(rune.runeId).then((r) => {
      // Degrade gracefully: a missing /fills (relay not redeployed) or a network blip just
      // means "no settled trades to show" — never an alarming error on the price panel.
      if (alive) setData({ runeId: rune.runeId, fills: 'fills' in r ? r.fills : [] })
    })
    return () => {
      alive = false
    }
  }, [rune.runeId])

  const loading = data?.runeId !== rune.runeId
  const fills = loading ? [] : data!.fills
  const series = [...fills].reverse().map(ppu) // oldest → newest
  const last = series.length ? series[series.length - 1] : null

  const w = 100
  const h = 40
  let line = ''
  let area = ''
  if (series.length >= 2) {
    const max = Math.max(...series)
    const min = Math.min(...series)
    const span = max - min || 1
    const step = w / (series.length - 1)
    const y = (v: number) => h - ((v - min) / span) * (h - 6) - 3
    line = series.map((v, i) => `${i === 0 ? 'M' : 'L'} ${i * step} ${y(v)}`).join(' ')
    area = `${line} L ${w} ${h} L 0 ${h} Z`
  }

  return (
    <div className="rounded-card border border-ink-600 bg-ink-800/60 p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-sm text-text-hi">{rune.sym} / $BELLS</span>
        {!loading && (
          <span className="flex items-center gap-1.5 font-micro text-[10px] uppercase tracking-wide text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> LIVE · {fills.length} settled
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex h-28 items-center justify-center text-sm text-text-lo">Reading settled swaps…</div>
      ) : fills.length === 0 ? (
        <div className="flex h-28 flex-col items-center justify-center rounded-btn border border-dashed border-ink-600 text-center text-xs text-text-lo">
          No trades settled yet.
          <span className="text-text-mid">Real swaps appear here the moment one fills.</span>
        </div>
      ) : (
        <>
          <div className="mb-1 flex items-baseline gap-2">
            <span className="font-mono text-2xl text-text-hi">{fmt(last!)}</span>
            <span className="text-xs text-text-lo">
              sats / {rune.sym} · last traded
            </span>
          </div>
          {series.length >= 2 ? (
            <div className="relative">
              <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-24 w-full">
                <defs>
                  <linearGradient id={`rc-${rune.id}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="var(--color-forge-500)" stopOpacity="0.35" />
                    <stop offset="1" stopColor="var(--color-forge-500)" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path d={area} fill={`url(#rc-${rune.id})`} />
                <motion.path
                  d={line}
                  fill="none"
                  stroke="var(--color-forge-400)"
                  strokeWidth="0.8"
                  vectorEffect="non-scaling-stroke"
                  initial={reduce ? false : { pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
                />
              </svg>
            </div>
          ) : (
            <div className="flex h-24 items-center justify-center rounded-btn border border-dashed border-ink-600 px-3 text-center text-xs text-text-lo">
              One swap settled so far — a price line appears once more trades fill.
            </div>
          )}
        </>
      )}
    </div>
  )
}
