import { motion } from 'motion/react'
import { SPRING_SNAP, SPRING_POP } from './motion'

export type ForgePhase = 'idle' | 'anticipate' | 'strike' | 'burst' | 'materialize' | 'settle'

/** Pure presentational pixel forge stage: a static anvil, a hammer that winds up
    and slams its HEAD onto the anvil centre, and an ingot that materializes.
    The hammer pivots at its grip (top); 0° = head straight down on the ingot,
    positive = raised to the left. Under reduced motion → still anvil + gold ingot. */
const HAMMER_ROT: Record<ForgePhase, number> = {
  idle: 38,
  anticipate: 58,
  strike: 0,
  burst: 0,
  materialize: 26,
  settle: 38,
}

const ingotVisible = (p: ForgePhase) => p === 'materialize' || p === 'settle'

export function ForgeStage({ phase, reduce }: { phase: ForgePhase; reduce: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-full w-full overflow-visible" aria-hidden>
      {/* anvil: base + tapered body + strike face */}
      <path d="M4 19 L6 22 H18 L20 19 Z" fill="var(--color-ink-950)" />
      <path d="M5 13 H19 L17.5 16.5 Q17 18 14.5 18 H9.5 Q7 18 6.5 16.5 Z" fill="var(--color-ink-900)" stroke="rgba(0,0,0,0.4)" strokeWidth="0.4" />
      <rect x="5" y="12.6" width="14" height="1.4" rx="0.6" fill="var(--color-ink-800)" />
      <rect x="5" y="12.6" width="14" height="0.7" rx="0.35" fill="rgba(255,122,26,0.5)" />

      {/* ingot resting on the anvil face */}
      {!reduce ? (
        <motion.rect
          x="8.6"
          y="11.1"
          width="6.8"
          height="2.2"
          rx="0.7"
          initial={false}
          animate={
            ingotVisible(phase)
              ? { scale: phase === 'materialize' ? [0, 1.2, 1] : 1, opacity: 1, fill: phase === 'materialize' ? '#ffd24a' : '#e0a810' }
              : { scale: 0, opacity: 0, fill: '#ffd24a' }
          }
          transition={phase === 'materialize' ? { duration: 0.46, ease: [0.22, 1, 0.36, 1] } : SPRING_POP}
          style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
        />
      ) : (
        <rect x="8.6" y="11.1" width="6.8" height="2.2" rx="0.7" fill="#ffd24a" />
      )}

      {/* hammer: a handle with a heavy HEAD at its working end, pivoting at the grip (top) */}
      <motion.g
        initial={false}
        animate={reduce ? { rotate: 38 } : { rotate: HAMMER_ROT[phase] }}
        transition={phase === 'strike' ? SPRING_SNAP : SPRING_POP}
        style={{ transformBox: 'view-box', transformOrigin: '12px 3px' } as React.CSSProperties}
      >
        {/* handle */}
        <rect x="11.2" y="2.6" width="1.6" height="8.2" rx="0.8" fill="var(--color-ink-900)" />
        <rect x="11.2" y="2.6" width="0.7" height="8.2" rx="0.35" fill="rgba(255,255,255,0.12)" />
        {/* head (the striking block) */}
        <rect x="8.3" y="9.2" width="7.4" height="3.5" rx="0.9" fill="var(--color-text-mid)" />
        <rect x="8.3" y="9.2" width="7.4" height="1.2" rx="0.5" fill="var(--color-text-hi)" />
        <rect x="8.3" y="11.6" width="7.4" height="1.1" rx="0.5" fill="var(--color-ink-700)" />
      </motion.g>
    </svg>
  )
}
