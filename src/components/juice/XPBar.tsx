import { motion, useReducedMotion } from 'motion/react'
import { TIER, type Tier } from './tiers'

/** Honest XP bar: a molten fill where frac = completed-quests / total. GPU scaleX,
    leading ember tip, empty-mold rim pulse at 0 quests. Header shows FORGE LEVEL +
    rank name + done/total. Non-compact shows the honesty caption (XP = quests, not
    a price/holders/volume figure). */
export function XPBar({
  done,
  total,
  rankName,
  tier,
  compact = false,
  className = '',
}: {
  done: number
  total: number
  rankName: string
  tier: Tier
  compact?: boolean
  className?: string
}) {
  const reduce = useReducedMotion()
  const frac = total === 0 ? 0 : Math.max(0, Math.min(1, done / total))
  const empty = frac <= 0
  const t = TIER[tier]
  return (
    <div className={className}>
      <div className="mb-2 flex items-end justify-between">
        <div className="flex items-center gap-2">
          <span className="font-micro text-[10px] tracking-[0.14em] text-forge-400">FORGE LEVEL</span>
          <span className="font-display text-sm" style={{ color: t.face }}>
            {rankName}
          </span>
        </div>
        <span className="font-mono text-xs text-text-mid">
          {done} / {total} quests
        </span>
      </div>
      <div className="relative h-2.5 w-full overflow-hidden rounded-pill bg-ink-700">
        {empty && !reduce && (
          <span className="mold-rim-pulse absolute inset-0 rounded-pill" style={{ boxShadow: 'inset 0 0 0 1px rgba(255,76,0,0.22)' }} />
        )}
        {!empty && (
          <motion.span
            className="absolute inset-y-0 left-0 origin-left rounded-pill"
            style={{
              width: '100%',
              transformOrigin: 'left',
              background: 'linear-gradient(90deg,var(--color-forge-600),var(--color-forge-400),var(--color-bell-300))',
              boxShadow: '0 0 10px rgba(255,76,0,0.5)',
            }}
            initial={reduce ? false : { scaleX: 0 }}
            animate={{ scaleX: frac }}
            transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          />
        )}
      </div>
      {!compact && (
        <p className="mt-2 text-[11px] leading-relaxed text-text-lo">
          Level = honest quests completed on regtest — not a price, holders, or volume figure.
        </p>
      )}
    </div>
  )
}
