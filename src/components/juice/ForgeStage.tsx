import { motion } from 'motion/react'
import { SPRING_SNAP, SPRING_POP } from './motion'

export type ForgePhase = 'idle' | 'anticipate' | 'strike' | 'burst' | 'materialize' | 'settle'

/** Pure presentational pixel forge stage: a static anvil, a hammer that winds up
    and slams, and an ingot that materializes. Driven entirely by the `phase` prop
    from ForgeButton. Under reduced motion → a still anvil + gold ingot chip. */
const HAMMER_ROT: Record<ForgePhase, number> = {
  idle: 0,
  anticipate: -52,
  strike: 18,
  burst: 18,
  materialize: 4,
  settle: 0,
}

const ingotVisible = (p: ForgePhase) => p === 'materialize' || p === 'settle'

export function ForgeStage({ phase, reduce }: { phase: ForgePhase; reduce: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-full w-full" aria-hidden>
      {/* anvil */}
      <path
        d="M3 18h18l-2 3H5l-2-3z"
        fill="var(--color-ink-950)"
        stroke="rgba(0,0,0,0.35)"
        strokeWidth="0.5"
      />
      <rect x="6" y="14" width="12" height="4" rx="1" fill="var(--color-ink-950)" />
      <rect x="6" y="14" width="12" height="1.2" rx="0.6" fill="rgba(255,122,26,0.5)" />

      {/* ingot on the anvil */}
      {!reduce ? (
        <motion.rect
          x="8.5"
          y="13.4"
          width="7"
          height="2.6"
          rx="0.8"
          initial={false}
          animate={
            ingotVisible(phase)
              ? { scale: phase === 'materialize' ? [0, 1.18, 1] : 1, opacity: 1, fill: phase === 'materialize' ? '#ffd24a' : '#e0a810' }
              : { scale: 0, opacity: 0, fill: '#ffd24a' }
          }
          transition={phase === 'materialize' ? { duration: 0.46, ease: [0.22, 1, 0.36, 1] } : SPRING_POP}
          style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
        />
      ) : (
        <rect x="8.5" y="13.4" width="7" height="2.6" rx="0.8" fill="#ffd24a" />
      )}

      {/* hammer (handle + head), swings around a pivot near the top-right */}
      <motion.g
        initial={false}
        animate={reduce ? { rotate: 0 } : { rotate: HAMMER_ROT[phase] }}
        transition={phase === 'strike' ? SPRING_SNAP : SPRING_POP}
        style={{ transformBox: 'view-box', transformOrigin: '17px 5px' } as React.CSSProperties}
      >
        <rect x="15.6" y="4" width="1.6" height="9" rx="0.8" fill="var(--color-ink-900)" />
        <rect x="11.5" y="2.2" width="6" height="3.4" rx="0.9" fill="var(--color-text-mid)" />
        <rect x="11.5" y="2.2" width="6" height="1" rx="0.5" fill="var(--color-text-hi)" />
      </motion.g>
    </svg>
  )
}
